const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs').promises;
const path = require('path');

// Peer files live inside the app directory so the Node process can write them
// directly — no sudo needed for file creation.  pppd is then called with
// "pppd file <absolute-path>" which only needs a single sudoers entry.
const PEERS_DIR = path.join(__dirname, '..', 'peers');

// chap-secrets is maintained in-app and exposed to pppd via a one-time symlink:
//   sudo ln -sf <this file> /etc/ppp/chap-secrets
// pppd uses fstat() which follows the symlink; it only needs the target to be
// a regular file with mode 600. That's what we write below.
const CHAP_SECRETS_FILE = path.join(__dirname, '..', 'chap-secrets');

// Ensure the peers directory exists on startup
fs.mkdir(PEERS_DIR, { recursive: true }).catch(() => {});

/**
 * Escapes a value for inclusion inside double-quotes in a chap-secrets line.
 * pppd's parser interprets backslash escapes and treats " as the terminator.
 */
function escapeChapField(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Rewrites /etc/ppp/chap-secrets (via the symlinked app file) from the DB.
 *
 * pppd needs to look up the password here (not just the peer file) to verify
 * the server's MSCHAPv2 response and derive MPPE session keys. The peer file's
 * own `password` directive is only used for OUTGOING auth — it can't satisfy
 * pppd's "remote system is required to authenticate itself" check, which is
 * triggered as soon as require-mppe-128 is in effect.
 *
 * Idempotent: reads all profiles from the DB and replaces the file contents.
 */
async function rebuildChapSecrets() {
    // Lazy require — avoids a circular dependency when this module is loaded
    // during DB init, and also means tests don't need a real DB to require it.
    const db = require('../db');
    const profiles = db.prepare('SELECT username, password FROM vpn_profiles').all();

    const header = [
        '# /etc/ppp/chap-secrets — managed by Mr.Fiber (do not hand-edit)',
        '# Re-generated on every profile create/edit/delete.',
        '# client              server    secret                 IP addresses',
        '',
    ].join('\n');

    // Each profile needs TWO chap-secrets entries — one for each direction of
    // the MSCHAPv2 mutual-auth handshake that require-mppe-128 triggers:
    //
    //   "username"  PPTP  "password"  *
    //     → us authenticating TO the server (client proves identity to server)
    //
    //   PPTP  "username"  "password"  *
    //     → server authenticating TO us (server proves identity to client)
    //     pppd looks this up as get_secret("PPTP", our_name) using `remotename PPTP`
    //
    // Without the second line pppd errors: "remote system is required to
    // authenticate itself but I couldn't find any suitable secret".
    const lines = profiles.map(p => [
        `"${escapeChapField(p.username)}"  PPTP  "${escapeChapField(p.password)}"  *`,
        `PPTP  "${escapeChapField(p.username)}"  "${escapeChapField(p.password)}"  *`,
    ].join('\n')).join('\n');

    const body = header + lines + '\n';
    // Mode 600 is required: pppd refuses to read chap-secrets if it's
    // group- or world-readable (check_access() in pppd/pathcheck.c).
    await fs.writeFile(CHAP_SECRETS_FILE, body, { encoding: 'utf8', mode: 0o600 });
    console.log(`[VPN] chap-secrets rewritten: ${profiles.length} profile(s)`);
}

// Build chap-secrets once on startup so a fresh deployment is immediately
// usable without requiring the user to edit each profile first.
rebuildChapSecrets().catch(e => console.error('[VPN] Initial chap-secrets build failed:', e.message));

/**
 * Writes the PPTP peer configuration file into the app-owned peers directory.
 * No sudo required — the Node process owns the directory.
 */
async function writeProfileFile(profile) {
    await fs.mkdir(PEERS_DIR, { recursive: true });

    // IMPORTANT: pppd processes options in order, last-wins. Debian's
    // /etc/ppp/options.pptp usually sets require-mppe-128 which (via
    // require-mschap-v2) flips auth_required back on — so if we `file` that
    // file *after* our `noauth`, our `noauth` gets clobbered and pppd dies
    // with "remote system is required to authenticate itself".
    //
    // Fix: inline the safe options ourselves and put `noauth` at the very end.
    const content = [
        `pty "pptp ${profile.server_address} --nolaunchpppd"`,
        `name "${profile.username}"`,
        `password "${profile.password}"`,
        `remotename PPTP`,
        // Standard PPTP client hygiene (these are what options.pptp normally provides)
        `lock`,
        `nobsdcomp`,
        `nodeflate`,
        // Require strong encryption. This implicitly enables require-mschap-v2,
        // which in turn sets auth_required=1 — we undo that with `noauth` below.
        `require-mppe-128`,
        // Lock down the auth method — refuse everything weaker than MSCHAPv2
        // so the server can't negotiate us down into a broken state.
        `refuse-pap`,
        `refuse-chap`,
        `refuse-mschap`,
        `refuse-eap`,
        `ipparam ${profile.name}`,
        // MUST be last: overrides the auth_required flipped on by require-mppe-128.
        // PPTP servers typically don't prove their identity, so we accept that.
        // MPPE session keys are still derived from the one-way MSCHAPv2 exchange.
        `noauth`,
        '',
    ].join('\n');

    const peerPath = path.join(PEERS_DIR, profile.name);
    await fs.writeFile(peerPath, content, { encoding: 'utf8', mode: 0o600 });
    console.log(`[VPN] Peer file written: ${peerPath}`);

    // Keep chap-secrets in sync so pppd can actually authenticate.
    // Rebuild from the DB (not just this profile) so concurrent edits
    // can't leave us with a stale file.
    await rebuildChapSecrets();

    // Errors propagate — callers must handle them so the user gets feedback.
}

/**
 * Deletes a PPTP peer configuration file from the app-owned peers directory.
 */
async function deleteProfileFile(name) {
    try {
        await fs.unlink(path.join(PEERS_DIR, name));
    } catch(e) {
        console.error('[VPN] Error deleting profile:', e.message);
    }
    // Keep chap-secrets in sync — a deleted profile's creds shouldn't linger
    // in the secrets file (otherwise an attacker with shell access could
    // reconnect using credentials the user thought were removed).
    try {
        await rebuildChapSecrets();
    } catch(e) {
        console.error('[VPN] chap-secrets rebuild after delete failed:', e.message);
    }
}

/**
 * Checks the status of ppp0 interface.
 */
async function getVpnStatus() {
    try {
        const { stdout } = await exec('ip addr show ppp0');
        const match = stdout.match(/inet (\d+\.\d+\.\d+\.\d+)/);
        if (match) {
            return { connected: true, interface: 'ppp0', assignedIp: match[1], activeProfile: 'Unknown' };
        }
    } catch(e) {}
    return { connected: false, interface: null, assignedIp: null, activeProfile: null };
}

/**
 * Connects to a VPN profile.
 *
 * Uses "sudo -n pppd file <path>" instead of "pon <name>" so that peer files
 * can live in the app directory rather than /etc/ppp/peers (which requires root
 * write access to create new files).
 *
 * Required sudoers entry (run: sudo visudo):
 *   <user> ALL=(root) NOPASSWD: /usr/sbin/pppd file *
 *
 * Replace <user> with the OS user that runs the Node process (check with:
 *   ps aux | grep node
 * Common values on cPanel: nobody, www-data, or the cPanel account username).
 */
async function connectVpn(profileName, oltSubnet) {
    console.log(`[VPN] Connecting to profile: ${profileName}`);

    // Kill any existing session first
    await disconnectVpn();

    const peerPath = path.join(PEERS_DIR, profileName);

    // Verify the peer file exists — if not, auto-regenerate from the DB.
    // This handles two cases:
    //   1. Profiles created before the app-owned-peers refactor (file lived in /etc/ppp/peers).
    //   2. The peers/ dir was wiped or the app was redeployed to a fresh path.
    try {
        await fs.access(peerPath);
    } catch(_e) {
        console.log(`[VPN] Peer file missing for "${profileName}" — regenerating from DB.`);
        const db = require('../db');
        const profile = db.prepare('SELECT name, server_address, username, password FROM vpn_profiles WHERE name = ?').get(profileName);
        if (!profile) {
            throw new Error(`Peer file not found and no DB record for profile "${profileName}". Re-save the profile in the UI.`);
        }
        await writeProfileFile(profile);
    }

    // Always refresh chap-secrets right before dialling. Cheap insurance against
    // it being stale (e.g. user upgraded from a pre-chap-secrets build and never
    // re-saved their profiles) — costs one DB read + one 600-mode file write.
    await rebuildChapSecrets().catch(e => console.error('[VPN] chap-secrets refresh failed:', e.message));

    // Launch pppd directly with our peer file. pppd detaches automatically.
    await exec(`sudo -n pppd file "${peerPath}"`);

    // Poll for ppp0 to come up instead of sleeping a fixed 6 seconds.
    // Typical PPTP negotiation finishes in 1–3 s; we give it 20 s max.
    console.log('[VPN] Waiting for ppp0 interface...');
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        try {
            const { stdout } = await exec('ip link show ppp0');
            if (stdout.includes('ppp0')) {
                console.log('[VPN] ppp0 is up');
                break;
            }
        } catch(_e) { /* ppp0 not yet visible */ }
        await new Promise(r => setTimeout(r, 500));
    }

    // Add routes — use /16 to cover both 192.168.0.x and 192.168.100.x OLTs
    // behind the VPN in one shot. `replace` instead of `add` so stale routes
    // from a previous session don't make this fail.
    const expandedSubnet = '192.168.0.0/16';
    try {
        console.log(`[VPN] Installing route: ${expandedSubnet} via ppp0`);
        await exec(`sudo -n ip route replace ${expandedSubnet} dev ppp0`);
        if (oltSubnet && oltSubnet !== expandedSubnet) {
            // More specific route for the caller's explicit OLT subnet (e.g. /24).
            // Linux prefers longer prefixes, so this wins over the /16 when applicable.
            await exec(`sudo -n ip route replace ${oltSubnet} dev ppp0`).catch(() => {});
        }
    } catch(e) {
        console.error('[VPN] Route installation error:', e.message);
    }

    return { success: true };
}

/**
 * Disconnects any active VPN sessions.
 *
 * We always use "poff -a" (kill all ppp sessions) rather than "poff <name>"
 * because our peer files live in the app-owned peers/ directory, not in
 * /etc/ppp/peers where poff looks them up by name. Killing all sessions is
 * fine here — the app only ever runs one VPN tunnel at a time.
 */
async function disconnectVpn(_profileName) {
    console.log('[VPN] Explicit Disconnect Triggered');
    try {
        await exec('sudo -n poff -a');
    } catch(e) {}

    // Fallback: kill any remaining pppd processes. poff -a occasionally misses
    // sessions started via "pppd file <path>" directly.
    try {
        await exec('sudo -n killall pppd');
    } catch(e) {}

    // Clean up routes pointing at the now-dead ppp0 so the kernel routing table
    // doesn't accumulate stale entries across reconnects.
    try {
        await exec('sudo -n ip route del 192.168.0.0/16 dev ppp0').catch(() => {});
    } catch(e) {}

    return { success: true };
}

module.exports = {
    writeProfileFile,
    deleteProfileFile,
    getVpnStatus,
    connectVpn,
    disconnectVpn,
};
