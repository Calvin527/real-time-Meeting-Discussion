const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 20 * 1024 * 1024, // allow local file/image/voice-note sharing up to 10MB safely
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const DISCUSSIONS_FILE = path.join(DATA_DIR, 'discussions.json');

const MAX_MESSAGE_LENGTH = 800;
const MAX_USERNAME_LENGTH = 20;
const MAX_ROOM_LENGTH = 40;
const MAX_PROJECT_LENGTH = 60;
const MAX_STORED_MESSAGES_PER_ROOM = 2500;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '✅', '👀'];

const MEETING_TEMPLATES = {
  standup: {
    label: 'Standup',
    agenda: ['What was completed?', 'What is planned next?', 'Blockers', 'Action items'],
  },
  retro: {
    label: 'Retro',
    agenda: ['What went well?', 'What did not go well?', 'What can improve?', 'Owners and next steps'],
  },
  brainstorm: {
    label: 'Brainstorm',
    agenda: ['Problem statement', 'Ideas', 'Shortlist / vote', 'Next steps'],
  },
  'client-call': {
    label: 'Client Call',
    agenda: ['Client context', 'Requirements / feedback', 'Decisions', 'Follow-up tasks'],
  },
  general: {
    label: 'General Meeting',
    agenda: ['Discussion points', 'Decisions', 'Action items', 'Recap'],
  },
};

function ensureFoldersAndFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DISCUSSIONS_FILE)) {
    fs.writeFileSync(DISCUSSIONS_FILE, JSON.stringify({ rooms: {} }, null, 2));
  }
}

ensureFoldersAndFiles();
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory online state only. Permanent records are stored in data/discussions.json.
// rooms: { roomName: { users: { socketId: { username, usernameKey, color, joinedAt } }, usernameKeys: { lowerCaseUsername: socketId } } }
const rooms = {};

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function randomColor() {
  const colors = ['#F87171', '#FB923C', '#FBBF24', '#A3E635', '#34D399', '#22D3EE', '#60A5FA', '#818CF8', '#C084FC', '#F472B6'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function sanitize(str) {
  return String(str || '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, MAX_USERNAME_LENGTH);
}

function normalizeRoomName(value) {
  return String(value || 'general')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, MAX_ROOM_LENGTH) || 'general';
}

function normalizeProject(value) {
  return sanitize(String(value || 'Unlinked project').trim().slice(0, MAX_PROJECT_LENGTH) || 'Unlinked project');
}

function normalizeTemplate(value) {
  const key = String(value || 'general').trim().toLowerCase();
  return MEETING_TEMPLATES[key] ? key : 'general';
}

function getUsernameKey(username) {
  return String(username || '').trim().toLowerCase();
}

function ensureRoomState(room) {
  if (!rooms[room]) rooms[room] = { users: {}, usernameKeys: {} };
  if (!rooms[room].users) rooms[room].users = {};
  if (!rooms[room].usernameKeys) rooms[room].usernameKeys = {};
  return rooms[room];
}

function removeEmptyRoom(room) {
  if (rooms[room] && Object.keys(rooms[room].users).length === 0) delete rooms[room];
}

function loadDiscussionStore() {
  try {
    ensureFoldersAndFiles();
    const raw = fs.readFileSync(DISCUSSIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.rooms || typeof parsed.rooms !== 'object') return { rooms: {} };
    return parsed;
  } catch (error) {
    console.error('Could not load discussion records. Starting with empty records.', error.message);
    return { rooms: {} };
  }
}

let discussionStore = loadDiscussionStore();

function saveDiscussionStore() {
  try {
    ensureFoldersAndFiles();
    fs.writeFileSync(DISCUSSIONS_FILE, JSON.stringify(discussionStore, null, 2));
  } catch (error) {
    console.error('Could not save discussion record:', error.message);
  }
}

function getRoomRecord(room) {
  if (!discussionStore.rooms[room]) {
    discussionStore.rooms[room] = {
      room,
      title: room,
      project: 'Unlinked project',
      template: 'general',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      participants: [],
      messages: [],
      decisions: [],
      tasks: [],
      lastSeen: {},
    };
  }

  const record = discussionStore.rooms[room];
  if (!Array.isArray(record.participants)) record.participants = [];
  if (!Array.isArray(record.messages)) record.messages = [];
  if (!Array.isArray(record.decisions)) record.decisions = [];
  if (!Array.isArray(record.tasks)) record.tasks = [];
  if (!record.lastSeen || typeof record.lastSeen !== 'object') record.lastSeen = {};
  if (!record.project) record.project = 'Unlinked project';
  if (!record.template || !MEETING_TEMPLATES[record.template]) record.template = 'general';
  return record;
}

function getMeetingMeta(record) {
  const template = MEETING_TEMPLATES[record.template] || MEETING_TEMPLATES.general;
  return {
    project: decodeEntities(record.project || 'Unlinked project'),
    templateKey: record.template || 'general',
    templateLabel: template.label,
    agenda: template.agenda,
  };
}

function updateMeetingMeta(room, project, template) {
  const record = getRoomRecord(room);
  record.project = normalizeProject(project || record.project || 'Unlinked project');
  record.template = normalizeTemplate(template || record.template || 'general');
  record.updatedAt = Date.now();
  saveDiscussionStore();
  return getMeetingMeta(record);
}

function hasParticipantJoinedBefore(room, username) {
  const record = getRoomRecord(room);
  return record.participants.some((name) => name.toLowerCase() === username.toLowerCase());
}

function rememberParticipant(room, username) {
  const record = getRoomRecord(room);
  if (!hasParticipantJoinedBefore(room, username)) record.participants.push(username);
}

function recordDiscussionMessage(room, message) {
  const record = getRoomRecord(room);
  record.messages.push(message);
  if (record.messages.length > MAX_STORED_MESSAGES_PER_ROOM) {
    record.messages = record.messages.slice(-MAX_STORED_MESSAGES_PER_ROOM);
  }
  record.updatedAt = Date.now();
  saveDiscussionStore();
}

function getRoomHistory(room) {
  return getRoomRecord(room).messages;
}

function findStoredMessage(room, messageId) {
  if (!messageId) return null;
  const record = getRoomRecord(room);
  return record.messages.find((message) => message.id === messageId && message.type === 'chat') || null;
}

function getRoomUsers(room) {
  if (!rooms[room]) return [];
  return Object.values(rooms[room].users)
    .map((u) => ({ username: u.username, color: u.color }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function isUsernameAlreadyOnline(room, username, socketId) {
  const roomState = ensureRoomState(room);
  const usernameKey = getUsernameKey(username);
  const existingSocketId = roomState.usernameKeys[usernameKey];
  if (!existingSocketId) return false;
  if (!roomState.users[existingSocketId]) {
    delete roomState.usernameKeys[usernameKey];
    return false;
  }
  return existingSocketId !== socketId;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMentions(text, room) {
  const plainText = decodeEntities(text);
  const users = getRoomUsers(room);
  return users
    .filter((user) => {
      const pattern = new RegExp(`(^|\\s)@${escapeRegex(user.username)}(?=$|\\s|[.,!?;:])`, 'i');
      return pattern.test(plainText);
    })
    .map((user) => ({ username: user.username, color: user.color }));
}

function buildSystemMessage(text, type) {
  return { id: makeId(), type: 'system', systemType: type, text: sanitize(text), timestamp: Date.now() };
}

function compactMessageForReply(originalReplyMessage) {
  if (!originalReplyMessage) return null;
  return {
    id: originalReplyMessage.id,
    username: originalReplyMessage.username,
    text: String(originalReplyMessage.text || '').slice(0, 140),
  };
}

function createChatMessage({ room, user, text, replyToId, attachment }) {
  const cleanText = sanitize(String(text || '').trim()).slice(0, MAX_MESSAGE_LENGTH);
  const originalReplyMessage = findStoredMessage(room, replyToId);
  const replyTo = compactMessageForReply(originalReplyMessage);
  const mentions = extractMentions(cleanText, room);

  return {
    id: makeId(),
    type: 'chat',
    username: user.username,
    color: user.color,
    text: cleanText,
    timestamp: Date.now(),
    socketId: user.socketId,
    replyTo,
    mentions,
    attachment: attachment || null,
    reactions: {},
  };
}

function extensionForMime(mimeType, fallbackName = '') {
  const clean = String(mimeType || '').split(';')[0].toLowerCase();
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
  };
  if (map[clean]) return map[clean];
  const ext = path.extname(String(fallbackName || '')).toLowerCase();
  return ext && ext.length <= 8 ? ext : '.bin';
}

function sanitizeFilename(filename) {
  const parsed = path.parse(String(filename || 'shared-file'));
  const base = parsed.name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 60) || 'shared-file';
  const ext = parsed.ext.replace(/[^.a-zA-Z0-9]/g, '').slice(0, 8);
  return `${base}${ext}`;
}

function saveDataUrlUpload({ dataUrl, originalName, mimeType, kind }) {
  const match = String(dataUrl || '').match(/^data:([^;]+(?:;[^,]+)?);base64,(.+)$/);
  if (!match) throw new Error('Invalid upload format.');

  const actualMime = String(mimeType || match[1] || 'application/octet-stream').split(';')[0];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('File is too large. Maximum allowed size is 10MB.');

  const safeOriginal = sanitizeFilename(originalName || `${kind || 'upload'}${extensionForMime(actualMime)}`);
  const ext = path.extname(safeOriginal) || extensionForMime(actualMime, safeOriginal);
  const fileBase = path.parse(safeOriginal).name || 'upload';
  const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${fileBase}${ext}`;
  const finalPath = path.join(UPLOADS_DIR, storedName);
  fs.writeFileSync(finalPath, buffer);

  return {
    id: makeId(),
    kind: kind || (actualMime.startsWith('image/') ? 'image' : actualMime.startsWith('audio/') ? 'voice' : 'document'),
    originalName: sanitize(safeOriginal),
    storedName,
    url: `/uploads/${storedName}`,
    mimeType: actualMime,
    size: buffer.length,
  };
}

function messageLooksActionable(text) {
  const plain = decodeEntities(text).toLowerCase();
  return /(task|todo|action|please|can you|could you|must|need to|needs to|fix|create|check|review|update|prepare|send|upload|finish|assign)/i.test(plain);
}

function addTasksFromMessage(room, message, createdBy) {
  const record = getRoomRecord(room);
  if (!Array.isArray(message.mentions) || message.mentions.length === 0) return [];
  if (!messageLooksActionable(message.text)) return [];

  const plainText = decodeEntities(message.text).trim();
  const created = [];
  message.mentions.forEach((mention) => {
    const duplicate = record.tasks.some((task) => task.sourceMessageId === message.id && task.assignedTo === mention.username);
    if (duplicate) return;
    const task = {
      id: makeId(),
      title: plainText.slice(0, 180),
      assignedTo: mention.username,
      createdBy,
      status: 'open',
      sourceMessageId: message.id,
      createdAt: Date.now(),
      completedAt: null,
    };
    record.tasks.push(task);
    created.push(task);
  });

  if (created.length) {
    record.updatedAt = Date.now();
    saveDiscussionStore();
  }
  return created;
}

function addDecision(room, text, createdBy, sourceMessageId = null) {
  const cleanText = sanitize(String(text || '').trim()).slice(0, 250);
  if (!cleanText) return null;
  const record = getRoomRecord(room);
  const decision = {
    id: makeId(),
    text: cleanText,
    createdBy,
    sourceMessageId,
    createdAt: Date.now(),
  };
  record.decisions.push(decision);
  record.updatedAt = Date.now();
  saveDiscussionStore();
  return decision;
}

function addManualTask(room, text, assignedTo, createdBy, sourceMessageId = null) {
  const cleanText = sanitize(String(text || '').trim()).slice(0, 180);
  if (!cleanText) return null;
  const record = getRoomRecord(room);
  const task = {
    id: makeId(),
    title: cleanText,
    assignedTo: sanitize(assignedTo || 'Unassigned'),
    createdBy,
    status: 'open',
    sourceMessageId,
    createdAt: Date.now(),
    completedAt: null,
  };
  record.tasks.push(task);
  record.updatedAt = Date.now();
  saveDiscussionStore();
  return task;
}

function buildSmartSummary(record, sinceTimestamp = null) {
  const messages = record.messages
    .filter((m) => m.type === 'chat')
    .filter((m) => !sinceTimestamp || m.timestamp >= sinceTimestamp);

  const latest = messages.slice(-18);
  const decisions = record.decisions.filter((d) => !sinceTimestamp || d.createdAt >= sinceTimestamp).slice(-6);
  const openTasks = record.tasks.filter((t) => t.status !== 'done').slice(-8);
  const attachments = latest.filter((m) => m.attachment).slice(-5);

  const lines = [];
  if (latest.length === 0 && decisions.length === 0 && openTasks.length === 0) {
    lines.push('No major updates yet. Start discussing and the summary will update automatically.');
  } else {
    if (latest.length) {
      const speakers = [...new Set(latest.map((m) => m.username))].slice(0, 6);
      lines.push(`Recent discussion involved ${speakers.join(', ')}.`);

      const important = latest
        .map((m) => ({ user: m.username, text: decodeEntities(m.text).replace(/\s+/g, ' ').trim() }))
        .filter((m) => m.text.length > 0)
        .filter((m) => /(decid|agree|task|todo|action|block|issue|client|deadline|need|must|fix|review|update|complete|upload)/i.test(m.text))
        .slice(-5);

      if (important.length) {
        lines.push('Key points:');
        important.forEach((m) => lines.push(`- ${m.user}: ${m.text.slice(0, 160)}`));
      } else {
        const sample = latest.slice(-4);
        lines.push('Recent messages:');
        sample.forEach((m) => lines.push(`- ${m.username}: ${decodeEntities(m.text).slice(0, 140)}`));
      }
    }

    if (decisions.length) {
      lines.push('Decisions:');
      decisions.forEach((d) => lines.push(`- ${decodeEntities(d.text)}`));
    }

    if (openTasks.length) {
      lines.push('Open tasks:');
      openTasks.forEach((t) => lines.push(`- @${decodeEntities(t.assignedTo)}: ${decodeEntities(t.title)}`));
    }

    if (attachments.length) {
      lines.push(`Shared files/voice notes: ${attachments.map((m) => decodeEntities(m.attachment.originalName)).join(', ')}.`);
    }
  }

  return lines.join('\n');
}

function buildRecapMarkdown(record) {
  const meta = getMeetingMeta(record);
  const generated = new Date().toLocaleString();
  const chatMessages = record.messages.filter((m) => m.type === 'chat');
  const lines = [
    `# ${record.room} Meeting Recap`,
    '',
    `**Project:** ${meta.project}`,
    `**Template:** ${meta.templateLabel}`,
    `**Generated:** ${generated}`,
    `**Participants:** ${record.participants.join(', ') || 'No participants recorded'}`,
    '',
    '## Live Summary',
    buildSmartSummary(record),
    '',
    '## Decisions',
  ];

  if (record.decisions.length) {
    record.decisions.forEach((d) => lines.push(`- ${new Date(d.createdAt).toLocaleString()} — ${decodeEntities(d.text)} (${d.createdBy})`));
  } else {
    lines.push('- No decisions logged yet.');
  }

  lines.push('', '## Tasks');
  if (record.tasks.length) {
    record.tasks.forEach((t) => lines.push(`- [${t.status === 'done' ? 'x' : ' '}] @${decodeEntities(t.assignedTo)} — ${decodeEntities(t.title)} (created by ${t.createdBy})`));
  } else {
    lines.push('- No tasks generated yet.');
  }

  lines.push('', '## Transcript');
  record.messages.forEach((message) => {
    const time = new Date(message.timestamp).toLocaleString();
    if (message.type === 'system') {
      lines.push(`- *${time} — ${decodeEntities(message.text)}*`);
      return;
    }
    const attachmentText = message.attachment ? ` [${message.attachment.kind}: ${decodeEntities(message.attachment.originalName)}](${message.attachment.url})` : '';
    const replyText = message.replyTo ? ` (replying to ${message.replyTo.username})` : '';
    lines.push(`- **${message.username}**${replyText}: ${decodeEntities(message.text)}${attachmentText}`);
  });

  return lines.join('\n');
}

function broadcastMeetingArtifacts(room) {
  const record = getRoomRecord(room);
  io.to(room).emit('meeting-artifacts', {
    meta: getMeetingMeta(record),
    decisions: record.decisions,
    tasks: record.tasks,
    summary: buildSmartSummary(record),
  });
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  function removeCurrentUserFromRoom({ notify = true } = {}) {
    if (!currentRoom || !currentUser || !rooms[currentRoom]) return;

    const roomToLeave = currentRoom;
    const userLeaving = currentUser;
    const roomState = rooms[roomToLeave];

    if (roomState.users[socket.id]) {
      delete roomState.users[socket.id];
      if (userLeaving.usernameKey && roomState.usernameKeys[userLeaving.usernameKey] === socket.id) {
        delete roomState.usernameKeys[userLeaving.usernameKey];
      }
      const record = getRoomRecord(roomToLeave);
      record.lastSeen[userLeaving.usernameKey] = Date.now();
      record.updatedAt = Date.now();
      saveDiscussionStore();

      if (notify) {
        const leaveMessage = buildSystemMessage(`${userLeaving.username} left the discussion`, 'leave');
        recordDiscussionMessage(roomToLeave, leaveMessage);
        socket.to(roomToLeave).emit('system-message', leaveMessage);
      }
      io.to(roomToLeave).emit('user-list', getRoomUsers(roomToLeave));
      removeEmptyRoom(roomToLeave);
    }

    socket.leave(roomToLeave);
    currentRoom = null;
    currentUser = null;
  }

  socket.on('join', ({ username, room, project, template }, callback) => {
    try {
      username = normalizeUsername(username);
      room = normalizeRoomName(room);
      if (!username) {
        if (callback) callback({ ok: false, error: 'Username is required.' });
        return;
      }

      removeCurrentUserFromRoom({ notify: true });
      const roomState = ensureRoomState(room);
      const usernameKey = getUsernameKey(username);

      if (isUsernameAlreadyOnline(room, username, socket.id)) {
        if (callback) callback({ ok: false, error: 'That name is already online in this discussion. Use another name, surname, or initial.' });
        return;
      }

      const meetingMeta = updateMeetingMeta(room, project, template);
      const record = getRoomRecord(room);
      const previousSeenAt = record.lastSeen && record.lastSeen[usernameKey] ? record.lastSeen[usernameKey] : record.createdAt;
      currentRoom = room;
      currentUser = { username, usernameKey, color: randomColor(), joinedAt: Date.now(), lastSeenAt: previousSeenAt, socketId: socket.id };
      roomState.users[socket.id] = currentUser;
      roomState.usernameKeys[usernameKey] = socket.id;
      socket.join(room);

      const history = record.messages;
      const chatCount = history.filter((message) => message.type === 'chat').length;

      if (callback) {
        callback({
          ok: true,
          username,
          room,
          color: currentUser.color,
          users: getRoomUsers(room),
          history,
          chatCount,
          meetingMeta,
          decisions: record.decisions,
          tasks: record.tasks,
          summary: buildSmartSummary(record),
        });
      }

      const hasJoinedBefore = hasParticipantJoinedBefore(room, username);
      const joinText = hasJoinedBefore ? `${username} joined again` : `${username} joined the discussion`;
      rememberParticipant(room, username);
      const joinMessage = buildSystemMessage(joinText, hasJoinedBefore ? 'rejoin' : 'join');
      recordDiscussionMessage(room, joinMessage);
      socket.to(room).emit('system-message', joinMessage);
      io.to(room).emit('user-list', getRoomUsers(room));
      broadcastMeetingArtifacts(room);
    } catch (err) {
      console.error(err);
      if (callback) callback({ ok: false, error: 'Something went wrong joining the discussion room.' });
    }
  });

  socket.on('chat-message', (payload) => {
    if (!currentRoom || !currentUser) return;
    const rawText = typeof payload === 'string' ? payload : (payload && payload.text);
    const replyToId = typeof payload === 'object' && payload ? payload.replyToId : null;
    let text = String(rawText || '').trim();
    if (!text) return;

    // Meeting commands
    if (/^\/decision\s+/i.test(text)) {
      const decisionText = text.replace(/^\/decision\s+/i, '').trim();
      const decision = addDecision(currentRoom, decisionText, currentUser.username);
      if (decision) {
        const systemMessage = buildSystemMessage(`${currentUser.username} logged a decision`, 'decision');
        recordDiscussionMessage(currentRoom, systemMessage);
        io.to(currentRoom).emit('system-message', systemMessage);
        broadcastMeetingArtifacts(currentRoom);
      }
      return;
    }

    if (/^\/task\s+/i.test(text)) {
      const taskText = text.replace(/^\/task\s+/i, '').trim();
      const mention = taskText.match(/@([a-zA-Z0-9_-]+)/);
      const assignedTo = mention ? mention[1] : 'Unassigned';
      const cleanTaskText = taskText.replace(/@([a-zA-Z0-9_-]+)/, '').trim() || taskText;
      const task = addManualTask(currentRoom, cleanTaskText, assignedTo, currentUser.username);
      if (task) {
        const systemMessage = buildSystemMessage(`${currentUser.username} created a task for @${assignedTo}`, 'task');
        recordDiscussionMessage(currentRoom, systemMessage);
        io.to(currentRoom).emit('system-message', systemMessage);
        broadcastMeetingArtifacts(currentRoom);
      }
      return;
    }

    const message = createChatMessage({ room: currentRoom, user: currentUser, text, replyToId });
    recordDiscussionMessage(currentRoom, message);
    io.to(currentRoom).emit('chat-message', message);

    const newTasks = addTasksFromMessage(currentRoom, message, currentUser.username);
    if (newTasks.length) {
      const names = newTasks.map((t) => `@${t.assignedTo}`).join(', ');
      const systemMessage = buildSystemMessage(`Task auto-created for ${names}`, 'task');
      recordDiscussionMessage(currentRoom, systemMessage);
      io.to(currentRoom).emit('system-message', systemMessage);
    }
    broadcastMeetingArtifacts(currentRoom);
  });

  socket.on('attachment-message', (payload, callback) => {
    try {
      if (!currentRoom || !currentUser) {
        if (callback) callback({ ok: false, error: 'Join a discussion first.' });
        return;
      }
      const attachment = saveDataUrlUpload({
        dataUrl: payload && payload.dataUrl,
        originalName: payload && payload.name,
        mimeType: payload && payload.mimeType,
        kind: payload && payload.kind,
      });
      const caption = String((payload && payload.caption) || '').trim() || (attachment.kind === 'voice' ? 'Voice note' : `Shared ${attachment.kind}`);
      const message = createChatMessage({
        room: currentRoom,
        user: currentUser,
        text: caption,
        replyToId: payload && payload.replyToId,
        attachment,
      });
      recordDiscussionMessage(currentRoom, message);
      io.to(currentRoom).emit('chat-message', message);
      broadcastMeetingArtifacts(currentRoom);
      if (callback) callback({ ok: true });
    } catch (err) {
      console.error(err.message);
      if (callback) callback({ ok: false, error: err.message || 'Could not share file.' });
    }
  });

  socket.on('reaction', ({ messageId, emoji }, callback) => {
    if (!currentRoom || !currentUser) return;
    if (!REACTION_EMOJIS.includes(emoji)) return;
    const record = getRoomRecord(currentRoom);
    const message = record.messages.find((m) => m.id === messageId && m.type === 'chat');
    if (!message) return;
    if (!message.reactions || typeof message.reactions !== 'object') message.reactions = {};
    if (!message.reactions[emoji]) message.reactions[emoji] = { users: [] };

    const users = message.reactions[emoji].users;
    const existingIndex = users.indexOf(currentUser.username);
    if (existingIndex >= 0) {
      users.splice(existingIndex, 1);
    } else {
      users.push(currentUser.username);
    }
    if (users.length === 0) delete message.reactions[emoji];
    record.updatedAt = Date.now();
    saveDiscussionStore();

    const reactions = message.reactions || {};
    io.to(currentRoom).emit('reaction-updated', { messageId, reactions });
    io.to(currentRoom).emit('live-reaction', { emoji, username: currentUser.username });
    if (callback) callback({ ok: true, reactions });
  });

  socket.on('log-decision-from-message', ({ messageId }, callback) => {
    if (!currentRoom || !currentUser) return;
    const message = findStoredMessage(currentRoom, messageId);
    if (!message) {
      if (callback) callback({ ok: false, error: 'Message not found.' });
      return;
    }
    const decision = addDecision(currentRoom, decodeEntities(message.text), currentUser.username, messageId);
    if (decision) {
      const systemMessage = buildSystemMessage(`${currentUser.username} logged a decision`, 'decision');
      recordDiscussionMessage(currentRoom, systemMessage);
      io.to(currentRoom).emit('system-message', systemMessage);
      broadcastMeetingArtifacts(currentRoom);
    }
    if (callback) callback({ ok: true });
  });

  socket.on('create-task-from-message', ({ messageId, assignedTo }, callback) => {
    if (!currentRoom || !currentUser) return;
    const message = findStoredMessage(currentRoom, messageId);
    if (!message) {
      if (callback) callback({ ok: false, error: 'Message not found.' });
      return;
    }
    const assignee = assignedTo || (message.mentions && message.mentions[0] && message.mentions[0].username) || currentUser.username;
    const task = addManualTask(currentRoom, decodeEntities(message.text), assignee, currentUser.username, messageId);
    if (task) {
      const systemMessage = buildSystemMessage(`${currentUser.username} created a task for @${assignee}`, 'task');
      recordDiscussionMessage(currentRoom, systemMessage);
      io.to(currentRoom).emit('system-message', systemMessage);
      broadcastMeetingArtifacts(currentRoom);
    }
    if (callback) callback({ ok: true });
  });

  socket.on('add-decision', ({ text }, callback) => {
    if (!currentRoom || !currentUser) return;
    const decision = addDecision(currentRoom, text, currentUser.username);
    if (decision) broadcastMeetingArtifacts(currentRoom);
    if (callback) callback({ ok: !!decision });
  });

  socket.on('complete-task', ({ taskId }, callback) => {
    if (!currentRoom || !currentUser) return;
    const record = getRoomRecord(currentRoom);
    const task = record.tasks.find((t) => t.id === taskId);
    if (!task) {
      if (callback) callback({ ok: false, error: 'Task not found.' });
      return;
    }
    task.status = task.status === 'done' ? 'open' : 'done';
    task.completedAt = task.status === 'done' ? Date.now() : null;
    record.updatedAt = Date.now();
    saveDiscussionStore();
    broadcastMeetingArtifacts(currentRoom);
    if (callback) callback({ ok: true });
  });

  socket.on('get-discussion-record', (_, callback) => {
    if (!currentRoom || !currentUser) {
      if (callback) callback({ ok: false, error: 'Join a discussion room first.' });
      return;
    }
    const record = getRoomRecord(currentRoom);
    if (callback) {
      callback({
        ok: true,
        room: currentRoom,
        project: decodeEntities(record.project),
        template: getMeetingMeta(record).templateLabel,
        generatedAt: Date.now(),
        messages: record.messages,
        decisions: record.decisions,
        tasks: record.tasks,
        chatCount: record.messages.filter((message) => message.type === 'chat').length,
      });
    }
  });

  socket.on('get-meeting-recap', (_, callback) => {
    if (!currentRoom || !currentUser) {
      if (callback) callback({ ok: false, error: 'Join a discussion room first.' });
      return;
    }
    const record = getRoomRecord(currentRoom);
    if (callback) callback({ ok: true, room: currentRoom, markdown: buildRecapMarkdown(record) });
  });

  socket.on('what-did-i-miss', (_, callback) => {
    if (!currentRoom || !currentUser) {
      if (callback) callback({ ok: false, error: 'Join a discussion room first.' });
      return;
    }
    const record = getRoomRecord(currentRoom);
    if (callback) {
      callback({
        ok: true,
        summary: buildSmartSummary(record, currentUser.lastSeenAt || currentUser.joinedAt),
      });
    }
  });

  socket.on('typing', (isTyping) => {
    if (!currentRoom || !currentUser) return;
    socket.to(currentRoom).emit('typing', { username: currentUser.username, isTyping: !!isTyping });
  });

  socket.on('leave-discussion', (_, callback) => {
    removeCurrentUserFromRoom({ notify: true });
    if (callback) callback({ ok: true });
  });

  socket.on('disconnect', () => {
    removeCurrentUserFromRoom({ notify: true });
  });
});

server.listen(PORT, () => {
  console.log(`Real-Time Meeting Discussion server running on http://localhost:${PORT}`);
});
