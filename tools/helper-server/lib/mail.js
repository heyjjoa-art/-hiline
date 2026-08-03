/*
 * 메일 수신함(메일플러그 IMAP) 조회 로직.
 * 원래 tools/mail-inbox/server.js에 있던 로직을 통합 도우미 서버(server.js)로 옮기며 분리했다.
 * loginMethod: 'LOGIN' 강제 지정 이유는 메일플러그가 AUTH=PLAIN을 광고하면서도 실제로는
 * "2 BAD invalid command"로 거부해 기본 SASL 인증이 멈춰버리기 때문(2026-07-22 확인).
 */
const fs = require('fs');
const { ImapFlow } = require('imapflow');

const DEFAULT_HOST = 'imap.mailplug.co.kr';
const DEFAULT_PORT = 993;

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error('mail-config.json이 없습니다. mail-config.example.json을 복사해서 만들어주세요 (README.md 참고).');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.email || !config.appPassword) {
    throw new Error('mail-config.json에 email/appPassword를 채워주세요.');
  }
  return config;
}

async function fetchInbox(limit, configPath) {
  const config = loadConfig(configPath);
  const client = new ImapFlow({
    host: config.host || DEFAULT_HOST,
    port: config.port || DEFAULT_PORT,
    secure: true,
    auth: { user: config.email, pass: config.appPassword, loginMethod: 'LOGIN' },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    // imapflow는 IMAP 서버가 NO/BAD로 응답하면 err.message에 "Command failed"라는 고정 문구만
    // 넣고, 실제 서버가 알려준 이유는 err.responseText에 따로 담아준다.
    const reason = err.responseText || err.message || '';
    if (/AUTHENTICATIONFAILED|Invalid credentials|application-specific password required/i.test(reason)) {
      throw new Error('로그인 실패: 앱 비밀번호가 올바른지 확인해주세요 (그룹웨어/기업메일 로그인 비밀번호는 사용할 수 없습니다). ' + reason);
    }
    if (/Lookup failed/i.test(reason)) {
      throw new Error('계정을 찾지 못했습니다(Lookup failed): 메일플러그 설정에서 이 계정의 POP3/IMAP 사용이 켜져 있는지 확인해주세요. ' + reason);
    }
    throw new Error(reason || err.message);
  }

  const messages = [];
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const total = client.mailbox.exists;
      if (total > 0) {
        const from = Math.max(1, total - limit + 1);
        for await (const msg of client.fetch(`${from}:${total}`, { envelope: true, flags: true, uid: true })) {
          const sender = msg.envelope.from && msg.envelope.from[0];
          messages.push({
            uid: msg.uid,
            subject: msg.envelope.subject || '(제목 없음)',
            from: sender ? (sender.name || sender.address) : '(발신자 없음)',
            fromAddress: sender ? sender.address : '',
            date: msg.envelope.date,
            unread: !msg.flags.has('\\Seen'),
          });
        }
      }
    } catch (err) {
      throw new Error(err.responseText || err.message);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  messages.reverse(); // 최신순
  return messages;
}

module.exports = { fetchInbox, loadConfig };
