(() => {
  const joinScreen = document.getElementById('join-screen');
  const chatScreen = document.getElementById('chat-screen');
  const joinForm = document.getElementById('join-form');
  const usernameInput = document.getElementById('username');
  const projectInput = document.getElementById('project');
  const roomInput = document.getElementById('room');
  const templateInput = document.getElementById('template');
  const joinError = document.getElementById('join-error');
  const joinBtn = document.getElementById('join-btn');

  const projectNameEl = document.getElementById('project-name');
  const channelNameEl = document.getElementById('channel-name');
  const chatTitleEl = document.getElementById('chat-title');
  const chatYouEl = document.getElementById('chat-you');
  const onlineSummaryEl = document.getElementById('online-summary');
  const userListEl = document.getElementById('user-list');
  const onlineCountEl = document.getElementById('online-count');
  const recordCountEl = document.getElementById('record-count');
  const downloadRecordBtn = document.getElementById('download-record-btn');
  const downloadRecapBtn = document.getElementById('download-recap-btn');
  const messagesEl = document.getElementById('messages');
  const typingIndicatorEl = document.getElementById('typing-indicator');
  const replyPreview = document.getElementById('reply-preview');
  const replyAuthorEl = document.getElementById('reply-author');
  const replyTextEl = document.getElementById('reply-text');
  const cancelReplyBtn = document.getElementById('cancel-reply-btn');
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const leaveBtn = document.getElementById('leave-btn');
  const connectionStatus = document.getElementById('connection-status');
  const connectionText = document.getElementById('connection-text');
  const emojiToggleBtn = document.getElementById('emoji-toggle-btn');
  const emojiPicker = document.getElementById('emoji-picker');
  const recordVoiceBtn = document.getElementById('record-voice-btn');
  const attachFileBtn = document.getElementById('attach-file-btn');
  const fileInput = document.getElementById('file-input');
  const uploadStatus = document.getElementById('upload-status');
  const liveReactionPop = document.getElementById('live-reaction-pop');
  const templateNameEl = document.getElementById('template-name');
  const agendaListEl = document.getElementById('agenda-list');
  const summaryTextEl = document.getElementById('summary-text');
  const missedBtn = document.getElementById('missed-btn');
  const copySummaryBtn = document.getElementById('copy-summary-btn');
  const decisionListEl = document.getElementById('decision-list');
  const decisionCountEl = document.getElementById('decision-count');
  const decisionForm = document.getElementById('decision-form');
  const decisionInput = document.getElementById('decision-input');
  const taskListEl = document.getElementById('task-list');
  const taskCountEl = document.getElementById('task-count');

  const emojiOptions = ['😀', '😂', '😊', '🔥', '👏', '🙏', '💡', '🚀', '✅', '⚠️', '📌', '🎯', '❤️', '👍', '👀'];
  const reactionOptions = ['👍', '❤️', '😂', '🎉', '✅', '👀'];
  const maxUploadBytes = 10 * 1024 * 1024;

  let socket = null;
  let me = { username: '', room: '', color: '' };
  let typingTimeout = null;
  let othersTyping = new Map();
  let replyingTo = null;
  let savedChatCount = 0;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;

  function decodeEntities(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDateTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function safeFilename(value, fallback = 'meeting-file') {
    return String(value || fallback).replace(/[^a-z0-9._-]/gi, '-').replace(/-+/g, '-').toLowerCase();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateRecordCount(count) {
    savedChatCount = Number(count || 0);
    recordCountEl.textContent = `${savedChatCount} saved chat${savedChatCount === 1 ? '' : 's'}`;
  }

  function showUploadStatus(text, isError = false) {
    uploadStatus.textContent = text || '';
    uploadStatus.classList.toggle('error', !!isError);
    if (text) setTimeout(() => { uploadStatus.textContent = ''; }, 3500);
  }

  function addSystemMessage(payload) {
    const div = document.createElement('div');
    div.className = 'msg-system';
    const systemText = typeof payload === 'string' ? payload : payload.text;
    div.textContent = decodeEntities(systemText);
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function renderReplyPreview() {
    if (!replyingTo) {
      replyPreview.classList.add('hidden');
      replyAuthorEl.textContent = '';
      replyTextEl.textContent = '';
      return;
    }
    replyAuthorEl.textContent = replyingTo.username;
    replyTextEl.textContent = decodeEntities(replyingTo.text);
    replyPreview.classList.remove('hidden');
  }

  function clearReply() {
    replyingTo = null;
    renderReplyPreview();
  }

  function insertTextAtCursor(text) {
    const currentValue = messageInput.value;
    const start = messageInput.selectionStart ?? currentValue.length;
    const end = messageInput.selectionEnd ?? currentValue.length;
    const before = currentValue.slice(0, start);
    const after = currentValue.slice(end);
    const newValue = `${before}${text}${after}`;
    messageInput.value = newValue;
    const cursor = (before + text).length;
    messageInput.setSelectionRange(cursor, cursor);
    messageInput.focus();
  }

  function insertMention(username) {
    if (!username || username === me.username) return;
    const mention = `@${username} `;
    const currentValue = messageInput.value;
    if (currentValue.toLowerCase().includes(mention.trim().toLowerCase())) {
      messageInput.focus();
      return;
    }
    const start = messageInput.selectionStart ?? currentValue.length;
    const before = currentValue.slice(0, start);
    const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
    insertTextAtCursor(`${needsSpaceBefore ? ' ' : ''}${mention}`);
  }

  function startReply(message) {
    replyingTo = { id: message.id, username: message.username, text: message.text };
    renderReplyPreview();
    if (message.username !== me.username) insertMention(message.username);
    messageInput.focus();
  }

  function renderAttachment(attachment) {
    if (!attachment) return null;
    const box = document.createElement('div');
    box.className = `attachment attachment-${attachment.kind || 'file'}`;

    const fileName = decodeEntities(attachment.originalName || 'shared file');
    if ((attachment.mimeType || '').startsWith('image/')) {
      const img = document.createElement('img');
      img.src = attachment.url;
      img.alt = fileName;
      img.loading = 'lazy';
      box.appendChild(img);
    } else if ((attachment.mimeType || '').startsWith('audio/') || attachment.kind === 'voice') {
      const audio = document.createElement('audio');
      audio.src = attachment.url;
      audio.controls = true;
      box.appendChild(audio);
    }

    const link = document.createElement('a');
    link.href = attachment.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = fileName;
    link.download = fileName;
    box.appendChild(link);

    const size = document.createElement('span');
    size.className = 'attachment-size';
    size.textContent = `${Math.max(1, Math.round((attachment.size || 0) / 1024))} KB`;
    box.appendChild(size);

    return box;
  }

  function renderReactions(messageId, reactions = {}) {
    const holder = document.createElement('div');
    holder.className = 'reaction-row';
    holder.dataset.reactionsFor = messageId;
    Object.entries(reactions || {}).forEach(([emoji, value]) => {
      const users = Array.isArray(value.users) ? value.users : [];
      if (!users.length) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = users.includes(me.username) ? 'reaction active' : 'reaction';
      btn.title = users.join(', ');
      btn.textContent = `${emoji} ${users.length}`;
      btn.addEventListener('click', () => sendReaction(messageId, emoji));
      holder.appendChild(btn);
    });
    return holder;
  }

  function updateReactions(messageId, reactions) {
    const wrapper = messagesEl.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!wrapper) return;
    const old = wrapper.querySelector('.reaction-row');
    if (old) old.remove();
    const row = renderReactions(messageId, reactions);
    if (row.children.length > 0) {
      const bubble = wrapper.querySelector('.msg-bubble');
      bubble.insertAdjacentElement('afterend', row);
    }
  }

  function sendReaction(messageId, emoji) {
    if (!socket || !messageId) return;
    socket.emit('reaction', { messageId, emoji });
  }

  function addChatMessage(message) {
    const { username, color, text, timestamp, id, replyTo, mentions, attachment, reactions } = message;
    const isMine = username === me.username;
    const mentionedMe = Array.isArray(mentions) && mentions.some((m) => m.username === me.username);

    const wrapper = document.createElement('div');
    wrapper.className = `msg ${isMine ? 'mine' : 'theirs'}${mentionedMe && !isMine ? ' mentioned-me' : ''}`;
    wrapper.dataset.messageId = id || '';

    const meta = document.createElement('div');
    meta.className = 'msg-meta';

    if (!isMine) {
      const author = document.createElement('button');
      author.type = 'button';
      author.className = 'msg-author';
      author.style.color = color;
      author.textContent = username;
      author.title = `Mention @${username}`;
      author.addEventListener('click', () => insertMention(username));
      meta.appendChild(author);
    }

    const time = document.createElement('span');
    time.textContent = formatTime(timestamp);
    meta.appendChild(time);

    if (mentionedMe && !isMine) {
      const mentionChip = document.createElement('span');
      mentionChip.className = 'mention-chip';
      mentionChip.textContent = 'mentioned you';
      meta.appendChild(mentionChip);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (replyTo) {
      const replyBox = document.createElement('div');
      replyBox.className = 'reply-context';
      const replyName = document.createElement('strong');
      replyName.textContent = `Replying to ${replyTo.username}`;
      const replyLine = document.createElement('span');
      replyLine.textContent = decodeEntities(replyTo.text);
      replyBox.appendChild(replyName);
      replyBox.appendChild(replyLine);
      bubble.appendChild(replyBox);
    }

    const textNode = document.createElement('span');
    textNode.textContent = decodeEntities(text);
    bubble.appendChild(textNode);

    const attachmentNode = renderAttachment(attachment);
    if (attachmentNode) bubble.appendChild(attachmentNode);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.textContent = 'Reply';
    replyBtn.addEventListener('click', () => startReply(message));
    actions.appendChild(replyBtn);

    const decisionBtn = document.createElement('button');
    decisionBtn.type = 'button';
    decisionBtn.textContent = 'Decision';
    decisionBtn.addEventListener('click', () => socket && socket.emit('log-decision-from-message', { messageId: id }));
    actions.appendChild(decisionBtn);

    const taskBtn = document.createElement('button');
    taskBtn.type = 'button';
    taskBtn.textContent = 'Task';
    taskBtn.addEventListener('click', () => socket && socket.emit('create-task-from-message', { messageId: id }));
    actions.appendChild(taskBtn);

    reactionOptions.forEach((emoji) => {
      const reactBtn = document.createElement('button');
      reactBtn.type = 'button';
      reactBtn.textContent = emoji;
      reactBtn.title = `React ${emoji}`;
      reactBtn.addEventListener('click', () => sendReaction(id, emoji));
      actions.appendChild(reactBtn);
    });

    wrapper.appendChild(meta);
    wrapper.appendChild(bubble);
    const reactionRow = renderReactions(id, reactions);
    if (reactionRow.children.length > 0) wrapper.appendChild(reactionRow);
    wrapper.appendChild(actions);
    messagesEl.appendChild(wrapper);
    scrollToBottom();
  }

  function renderHistory(history, chatCount) {
    messagesEl.innerHTML = '';
    (history || []).forEach((message) => {
      if (message.type === 'chat') addChatMessage(message);
      else addSystemMessage(message);
    });
    updateRecordCount(chatCount ?? (history || []).filter((message) => message.type === 'chat').length);
  }

  function renderUserList(users = []) {
    userListEl.innerHTML = '';
    onlineCountEl.textContent = users.length;
    onlineSummaryEl.textContent = `${users.length} online user${users.length === 1 ? '' : 's'}`;

    if (users.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'user-list-empty';
      empty.textContent = 'No users online';
      userListEl.appendChild(empty);
      return;
    }

    users.slice().sort((a, b) => a.username.localeCompare(b.username)).forEach((u) => {
      const li = document.createElement('li');
      if (u.username === me.username) li.classList.add('is-me');
      if (u.username !== me.username) li.classList.add('can-mention');
      li.title = u.username === me.username ? 'This is you' : `Click to mention @${u.username}`;
      li.addEventListener('click', () => insertMention(u.username));

      const dot = document.createElement('span');
      dot.className = 'user-dot';
      dot.style.color = u.color;
      dot.style.background = u.color;

      const name = document.createElement('span');
      name.className = 'username-text';
      name.textContent = u.username === me.username ? `${u.username} (you)` : u.username;

      li.appendChild(dot);
      li.appendChild(name);
      userListEl.appendChild(li);
    });
  }

  function renderMeetingMeta(meta = {}) {
    projectNameEl.textContent = meta.project || 'Unlinked project';
    templateNameEl.textContent = meta.templateLabel || 'General Meeting';
    agendaListEl.innerHTML = '';
    (meta.agenda || []).forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      agendaListEl.appendChild(li);
    });
  }

  function renderDecisions(decisions = []) {
    decisionListEl.innerHTML = '';
    decisionCountEl.textContent = decisions.length;
    if (!decisions.length) {
      const li = document.createElement('li');
      li.className = 'artifact-empty';
      li.textContent = 'No decisions logged yet.';
      decisionListEl.appendChild(li);
      return;
    }
    decisions.slice().reverse().forEach((decision) => {
      const li = document.createElement('li');
      const text = document.createElement('p');
      text.textContent = decodeEntities(decision.text);
      const meta = document.createElement('span');
      meta.textContent = `${decision.createdBy} · ${formatTime(decision.createdAt)}`;
      li.appendChild(text);
      li.appendChild(meta);
      decisionListEl.appendChild(li);
    });
  }

  function renderTasks(tasks = []) {
    taskListEl.innerHTML = '';
    taskCountEl.textContent = tasks.filter((t) => t.status !== 'done').length;
    if (!tasks.length) {
      const li = document.createElement('li');
      li.className = 'artifact-empty';
      li.textContent = 'No tasks yet.';
      taskListEl.appendChild(li);
      return;
    }
    tasks.slice().reverse().forEach((task) => {
      const li = document.createElement('li');
      li.className = task.status === 'done' ? 'task-done' : '';

      const text = document.createElement('p');
      text.textContent = decodeEntities(task.title);

      const meta = document.createElement('span');
      meta.textContent = `@${decodeEntities(task.assignedTo)} · ${task.status}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = task.status === 'done' ? 'Reopen' : 'Done';
      btn.addEventListener('click', () => socket && socket.emit('complete-task', { taskId: task.id }));

      li.appendChild(text);
      li.appendChild(meta);
      li.appendChild(btn);
      taskListEl.appendChild(li);
    });
  }

  function renderArtifacts(payload = {}) {
    if (payload.meta) renderMeetingMeta(payload.meta);
    renderDecisions(payload.decisions || []);
    renderTasks(payload.tasks || []);
    summaryTextEl.textContent = decodeEntities(payload.summary || 'No summary yet.');
  }

  function updateTypingIndicator() {
    const names = Array.from(othersTyping.keys());
    if (names.length === 0) {
      typingIndicatorEl.classList.remove('visible');
      typingIndicatorEl.textContent = '';
      return;
    }
    let text;
    if (names.length === 1) text = `${names[0]} is typing…`;
    else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
    else text = `${names.length} people are typing…`;
    typingIndicatorEl.textContent = text;
    typingIndicatorEl.classList.add('visible');
  }

  function setConnectionStatus(online) {
    connectionStatus.classList.toggle('online', online);
    connectionText.textContent = online ? 'Connected' : 'Reconnecting…';
  }

  function resetToJoinScreen() {
    clearReply();
    messagesEl.innerHTML = '';
    userListEl.innerHTML = '';
    onlineSummaryEl.textContent = '0 online users';
    othersTyping.forEach((timeoutId) => clearTimeout(timeoutId));
    othersTyping.clear();
    updateTypingIndicator();
    updateRecordCount(0);
    onlineCountEl.textContent = '0';
    channelNameEl.textContent = '#discussion';
    chatTitleEl.textContent = '#discussion';
    chatYouEl.textContent = 'not connected';
    renderArtifacts({ meta: { project: 'Unlinked project', templateLabel: 'General Meeting', agenda: [] }, decisions: [], tasks: [], summary: 'No summary yet.' });
    me = { username: '', room: '', color: '' };
    chatScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');
    setConnectionStatus(false);
    joinBtn.disabled = false;
    joinBtn.querySelector('span').textContent = 'Join discussion';
    usernameInput.focus();
  }

  function buildTranscript(record) {
    const lines = [
      'Real-Time Meeting Discussion Record',
      `Project: ${record.project || 'Unlinked project'}`,
      `Room: #${record.room}`,
      `Template: ${record.template || 'General Meeting'}`,
      `Downloaded: ${formatDateTime(record.generatedAt)}`,
      `Saved chats: ${record.chatCount}`,
      '',
      'Discussion transcript',
      '---------------------',
    ];

    record.messages.forEach((message) => {
      const time = formatDateTime(message.timestamp);
      if (message.type === 'system') {
        lines.push(`[${time}] * ${decodeEntities(message.text)}`);
        return;
      }
      if (message.replyTo) {
        lines.push(`[${time}] ${message.username} replied to ${message.replyTo.username}: ${decodeEntities(message.text)}`);
        lines.push(`  Original: ${decodeEntities(message.replyTo.text)}`);
      } else {
        lines.push(`[${time}] ${message.username}: ${decodeEntities(message.text)}`);
      }
      if (message.attachment) {
        lines.push(`  Attachment: ${decodeEntities(message.attachment.originalName)} (${message.attachment.url})`);
      }
      if (Array.isArray(message.mentions) && message.mentions.length > 0) {
        lines.push(`  Mentions: ${message.mentions.map((m) => `@${m.username}`).join(', ')}`);
      }
    });

    lines.push('', 'Decisions', '---------');
    (record.decisions || []).forEach((d) => lines.push(`- ${decodeEntities(d.text)} (${d.createdBy})`));
    if (!record.decisions || record.decisions.length === 0) lines.push('- No decisions logged.');

    lines.push('', 'Tasks', '-----');
    (record.tasks || []).forEach((t) => lines.push(`- [${t.status === 'done' ? 'x' : ' '}] @${decodeEntities(t.assignedTo)} ${decodeEntities(t.title)}`));
    if (!record.tasks || record.tasks.length === 0) lines.push('- No tasks created.');

    return lines.join('\n');
  }

  function downloadText(filename, text, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function showLiveReaction(payload) {
    if (!payload || !payload.emoji) return;
    liveReactionPop.textContent = `${payload.emoji} ${payload.username || ''}`;
    liveReactionPop.classList.remove('hidden');
    liveReactionPop.classList.add('show');
    setTimeout(() => {
      liveReactionPop.classList.remove('show');
      liveReactionPop.classList.add('hidden');
    }, 1200);
  }

  function connectSocket() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => setConnectionStatus(true));
    socket.on('disconnect', () => setConnectionStatus(false));

    socket.on('chat-message', (payload) => {
      addChatMessage(payload);
      updateRecordCount(savedChatCount + 1);
    });

    socket.on('system-message', (payload) => addSystemMessage(payload));
    socket.on('user-list', (users) => renderUserList(users));
    socket.on('meeting-artifacts', (payload) => renderArtifacts(payload));
    socket.on('reaction-updated', ({ messageId, reactions }) => updateReactions(messageId, reactions));
    socket.on('live-reaction', (payload) => showLiveReaction(payload));

    socket.on('typing', ({ username, isTyping }) => {
      if (username === me.username) return;
      if (isTyping) {
        clearTimeout(othersTyping.get(username));
        const t = setTimeout(() => {
          othersTyping.delete(username);
          updateTypingIndicator();
        }, 2500);
        othersTyping.set(username, t);
      } else {
        clearTimeout(othersTyping.get(username));
        othersTyping.delete(username);
      }
      updateTypingIndicator();
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
      reader.readAsDataURL(file);
    });
  }

  async function shareFile(file, kind = null, caption = '') {
    if (!file || !socket) return;
    if (file.size > maxUploadBytes) {
      showUploadStatus('File is too large. Max size is 10MB.', true);
      return;
    }
    try {
      showUploadStatus('Uploading…');
      const dataUrl = await fileToDataUrl(file);
      socket.emit('attachment-message', {
        dataUrl,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        kind: kind || (file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'voice' : 'document'),
        caption: caption || messageInput.value.trim(),
        replyToId: replyingTo ? replyingTo.id : null,
      }, (res) => {
        if (!res || !res.ok) {
          showUploadStatus((res && res.error) || 'Upload failed.', true);
          return;
        }
        showUploadStatus('Shared successfully.');
        if (caption || messageInput.value.trim()) messageInput.value = '';
        clearReply();
      });
    } catch (err) {
      showUploadStatus('Could not upload file.', true);
    }
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      showUploadStatus('Voice notes are not supported in this browser.', true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      });
      mediaRecorder.addEventListener('stop', async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
        isRecording = false;
        recordVoiceBtn.classList.remove('recording');
        recordVoiceBtn.textContent = '🎙 Voice note';
        await shareFile(file, 'voice', 'Voice note');
      });
      mediaRecorder.start();
      isRecording = true;
      recordVoiceBtn.classList.add('recording');
      recordVoiceBtn.textContent = '■ Stop recording';
      showUploadStatus('Recording voice note…');
    } catch (err) {
      showUploadStatus('Microphone permission was denied.', true);
    }
  }

  function stopVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }

  function renderEmojiPicker() {
    emojiPicker.innerHTML = '';
    emojiOptions.forEach((emoji) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        insertTextAtCursor(emoji);
        emojiPicker.classList.add('hidden');
      });
      emojiPicker.appendChild(btn);
    });
  }

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    joinError.textContent = '';

    const username = usernameInput.value.trim();
    const project = projectInput.value.trim() || 'Unlinked project';
    const room = roomInput.value.trim() || 'general';
    const template = templateInput.value;

    if (!username) {
      joinError.textContent = 'Please enter your name.';
      return;
    }

    joinBtn.disabled = true;
    joinBtn.querySelector('span').textContent = 'Joining…';
    if (!socket) connectSocket();

    const attemptJoin = () => {
      socket.emit('join', { username, project, room, template }, (res) => {
        joinBtn.disabled = false;
        joinBtn.querySelector('span').textContent = 'Join discussion';

        if (!res || !res.ok) {
          joinError.textContent = (res && res.error) || 'Could not join. Try again.';
          return;
        }

        me = { username: res.username, room: res.room, color: res.color };
        channelNameEl.textContent = `#${res.room}`;
        chatTitleEl.textContent = `#${res.room}`;
        chatYouEl.textContent = `connected as ${res.username}`;
        renderUserList(res.users);
        renderHistory(res.history, res.chatCount);
        renderArtifacts({ meta: res.meetingMeta, decisions: res.decisions, tasks: res.tasks, summary: res.summary });
        clearReply();

        joinScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');
        setTimeout(scrollToBottom, 0);
        messageInput.focus();
      });
    };

    if (socket.connected) attemptJoin();
    else socket.once('connect', attemptJoin);
  });

  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !socket) return;
    socket.emit('chat-message', { text, replyToId: replyingTo ? replyingTo.id : null });
    socket.emit('typing', false);
    messageInput.value = '';
    clearReply();
  });

  messageInput.addEventListener('input', () => {
    if (!socket) return;
    socket.emit('typing', true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('typing', false), 1200);
  });

  cancelReplyBtn.addEventListener('click', clearReply);

  emojiToggleBtn.addEventListener('click', () => {
    emojiPicker.classList.toggle('hidden');
  });

  attachFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) shareFile(file);
    fileInput.value = '';
  });

  recordVoiceBtn.addEventListener('click', () => {
    if (isRecording) stopVoiceRecording();
    else startVoiceRecording();
  });

  downloadRecordBtn.addEventListener('click', () => {
    if (!socket) return;
    socket.emit('get-discussion-record', null, (res) => {
      if (!res || !res.ok) {
        addSystemMessage((res && res.error) || 'Could not download the discussion record.');
        return;
      }
      updateRecordCount(res.chatCount);
      downloadText(`${safeFilename(res.room)}-discussion-transcript.txt`, buildTranscript(res));
    });
  });

  downloadRecapBtn.addEventListener('click', () => {
    if (!socket) return;
    socket.emit('get-meeting-recap', null, (res) => {
      if (!res || !res.ok) {
        addSystemMessage((res && res.error) || 'Could not download the meeting recap.');
        return;
      }
      downloadText(`${safeFilename(res.room)}-meeting-recap.md`, res.markdown, 'text/markdown;charset=utf-8');
    });
  });

  missedBtn.addEventListener('click', () => {
    if (!socket) return;
    socket.emit('what-did-i-miss', null, (res) => {
      if (!res || !res.ok) return;
      summaryTextEl.textContent = decodeEntities(res.summary || 'No new updates since you joined.');
    });
  });

  copySummaryBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(summaryTextEl.textContent || '');
      copySummaryBtn.textContent = 'Copied';
      setTimeout(() => { copySummaryBtn.textContent = 'Copy'; }, 1200);
    } catch (err) {
      showUploadStatus('Could not copy summary.', true);
    }
  });

  decisionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = decisionInput.value.trim();
    if (!text || !socket) return;
    socket.emit('add-decision', { text });
    decisionInput.value = '';
  });

  leaveBtn.addEventListener('click', () => {
    if (!socket) {
      resetToJoinScreen();
      return;
    }
    leaveBtn.disabled = true;
    const finishLeaving = () => {
      if (socket && socket.connected) socket.disconnect();
      socket = null;
      leaveBtn.disabled = false;
      resetToJoinScreen();
    };
    if (socket.connected) socket.emit('leave-discussion', null, () => finishLeaving());
    else finishLeaving();
  });

  renderEmojiPicker();
})();
