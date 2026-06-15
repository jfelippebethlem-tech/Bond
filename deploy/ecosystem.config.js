/**
 * PM2 ecosystem — ARTEFATO AUTÔNOMO.
 *
 * Todos os caminhos são derivados da localização DESTE arquivo (__dirname),
 * então funciona em qualquer usuário e qualquer pasta sem editar nada:
 *   /root/JFN, /home/ubuntu/JFN, /home/user/JFN, C:\jfn, etc.
 *
 * Os logs ficam DENTRO do projeto (./logs) — não precisa de sudo nem de
 * /var/log. Para usar:
 *   pm2 start ecosystem.config.js     (a partir da raiz do projeto)
 *   pm2 logs / pm2 status / pm2 restart all
 */
const path = require('path')

const ROOT = __dirname                      // raiz do projeto (onde este arquivo está)
const LOGS = path.join(ROOT, 'logs')        // logs dentro do projeto
const NEXT = path.join(ROOT, 'node_modules', '.bin', 'next')
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx')

// Fábrica de worker (processos fork: bond, hermes, whatsapp)
function worker(name, script) {
  return {
    name,
    script: TSX,
    args: script,
    cwd: ROOT,
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '400M',
    env: { NODE_ENV: 'production' },
    error_file: path.join(LOGS, `${name}-err.log`),
    out_file: path.join(LOGS, `${name}-out.log`),
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    autorestart: true,
    watch: false,
  }
}

module.exports = {
  apps: [
    {
      name: 'politimonitor',
      script: NEXT,
      args: 'start',
      cwd: ROOT,
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '800M',
      env: { NODE_ENV: 'production', PORT: 3000 },
      error_file: path.join(LOGS, 'app-err.log'),
      out_file: path.join(LOGS, 'app-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      watch: false,
      restart_delay: 3000,
    },
    worker('bond-worker', 'src/agent/bond-worker.ts'),
    worker('hermes-worker', 'src/agent/hermes-worker.ts'),
    worker('telegram-worker', 'src/bot/telegram.ts'),
    worker('whatsapp-worker', 'src/agent/whatsapp-worker.ts'),
  ],
}
