const net = require('net');

class TelnetClient {
  constructor(host, port = 23, timeout = 15000) {
    this.host = host;
    this.port = port;
    this.timeout = timeout;
    this.socket = null;
    this.dataBuffer = '';
    this.resolvers = [];
  }

  stripIAC(buffer) {
    const result = [];
    const responses = [];
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0xFF) {
        if (i + 1 < buffer.length) {
          const cmd = buffer[i + 1];
          if (cmd === 253) {
            const opt = buffer[i + 2] || 0;
            responses.push(Buffer.from([0xFF, 0xFC, opt]));
            i += 2;
            continue;
          } else if (cmd === 251) {
            const opt = buffer[i + 2] || 0;
            responses.push(Buffer.from([0xFF, 0xFE, opt]));
            i += 2;
            continue;
          } else if ([252, 254].includes(cmd)) {
            i += 2;
            continue;
          } else {
            i += 1;
            continue;
          }
        }
      }
      result.push(buffer[i]);
    }
    return { cleaned: Buffer.from(result), responses };
  }

  _onData(data) {
    const { cleaned, responses } = this.stripIAC(data);

    if (this.socket && responses.length > 0) {
      for (const resp of responses) {
        this.socket.write(resp);
      }
    }

    const text = cleaned.toString('utf8');
    if (text.length > 0) {
      this.dataBuffer += text;
    }

    if (this.resolvers.length > 0) {
      const { condition, resolve, timer } = this.resolvers[0];
      if (condition(this.dataBuffer)) {
        this.resolvers.shift();
        clearTimeout(timer);
        const out = this.dataBuffer;
        this.dataBuffer = '';
        resolve(out);
      }
    }
  }

  waitFor(promptPattern, customTimeout) {
    const timeoutMs = customTimeout || this.timeout;
    return new Promise((resolve, reject) => {
      const condition = typeof promptPattern === 'string'
        ? (buf) => buf.includes(promptPattern)
        : (buf) => promptPattern.test(buf);

      if (condition(this.dataBuffer)) {
        const out = this.dataBuffer;
        this.dataBuffer = '';
        return resolve(out);
      }

      const timer = setTimeout(() => {
        const idx = this.resolvers.findIndex(r => r.timer === timer);
        if (idx > -1) this.resolvers.splice(idx, 1);
        reject(new Error(`Timeout waiting for prompt: ${promptPattern} (buffer: ${JSON.stringify(this.dataBuffer.substring(0, 300))})`));
      }, timeoutMs);

      this.resolvers.push({ resolve, condition, timer });
    });
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.socket.setTimeout(this.timeout);

      this.socket.on('data', (data) => this._onData(data));
      this.socket.on('error', (err) => reject(err));
      this.socket.on('timeout', () => {
        this.disconnect();
        reject(new Error('Socket timeout'));
      });

      this.socket.connect(this.port, this.host, () => {
        resolve();
      });
    });
  }

  async login(username, password) {
    try {
      // Step 1: Wait for Username prompt (Genexis sends "Username(1-64 chars):")
      // Some devices are silent — nudge with CRLF if needed
      let gotPrompt = false;

      try {
        await this.waitFor(/[Uu]sername|[Ll]ogin:/i, 5000);
        gotPrompt = true;
      } catch (e) {
        this.socket.write('\r\n');
        await new Promise(r => setTimeout(r, 1000));
      }

      if (!gotPrompt) {
        try {
          await this.waitFor(/[Uu]sername|[Ll]ogin:/i, 5000);
        } catch (e) {
          this.socket.write('\r\n');
          await this.waitFor(/[Uu]sername|[Ll]ogin:|[#>]/i, 5000);
        }
      }

      // Step 2: Send username
      this.socket.write(username + '\r\n');

      // Step 3: Wait for Password prompt
      await this.waitFor(/[Pp]assword/i, 10000);

      // Step 4: Send password
      this.socket.write(password + '\r\n');

      // Step 5: Wait for initial prompt (> for Genexis Saturn unprivileged mode)
      const loginResult = await this.waitFor(/[#>]/i, 10000);
      if (/incorrect|fail|denied|invalid|bad/i.test(loginResult)) {
        throw new Error('Authentication failed');
      }

      // Step 6: Enter enable mode (Genexis Saturn requires "en" to get #)
      this.dataBuffer = '';
      this.socket.write('en\r\n');
      await this.waitFor(/#/, 5000);

      // Step 7: Enter config terminal mode (Genexis Saturn requires "c t")
      this.dataBuffer = '';
      this.socket.write('c t\r\n');
      await this.waitFor(/[#(]/, 5000);

      // Now at (config)# — ready for OLT commands
    } catch (err) {
      this.disconnect();
      throw err;
    }
  }

  async sendCommand(command) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Socket not connected');
    }

    this.dataBuffer = '';
    this.socket.write(command + '\r\n');

    let fullOutput = '';

    while (true) {
      const out = await this.waitFor(/[#>]|(\.\.\.\.press ENTER to next line.*?\.\.\.\.)/i, 30000);
      fullOutput += out;

      if (/press ENTER to next line/i.test(out)) {
        fullOutput = fullOutput.replace(/\.\.\.\.press ENTER to next line.*?\.\.\.\./gi, '');
        this.socket.write('\r\n');
      } else {
        break;
      }
    }

    return fullOutput;
  }

  async executeMacro(commands) {
    const logs = [];
    for (const cmd of commands) {
      if (!cmd) continue;
      const out = await this.sendCommand(cmd);
      logs.push(out);
      await new Promise(r => setTimeout(r, 300));
    }
    return logs.join('\n');
  }

  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.resolvers.forEach(r => clearTimeout(r.timer));
    this.resolvers = [];
  }
}

module.exports = TelnetClient;
