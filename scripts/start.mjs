import { spawn } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { env, stdio: 'inherit', windowsHide: true });
child.on('exit', code => process.exit(code || 0));
child.on('error', error => { console.error('GigMan konnte nicht gestartet werden:', error.message); process.exit(1); });
