# Real-Time Meeting Discussion

A full-stack real-time meeting discussion app built with **Node.js**, **Express**, **Socket.IO**, and a responsive vanilla **HTML/CSS/JavaScript** frontend.

This version upgrades the app from a simple chat into a project-linked meeting workspace with chat history, mentions, replies, reactions, voice notes, document/image sharing, decision logs, meeting templates, task assignment, and downloadable recaps.

## Main Features

- **Real-time discussion chat** using Socket.IO
- **Project-linked meetings** with a project name and discussion room
- **Meeting templates**: Standup, Retro, Brainstorm, Client Call, and General Meeting
- **Saved discussion records** stored locally in `data/discussions.json`
- **Download transcript** as a `.txt` file
- **Download meeting recap** as a Google Docs / Drive-ready `.md` Markdown file
- **Online user list** with duplicate-name blocking inside the same room
- **Mentions** using `@username`
- **Message replies** with reply preview
- **Live emoji reactions** on messages
- **Emoji picker** for chat messages
- **Voice notes** using the browser microphone
- **Document and image sharing** with local server storage in the `uploads/` folder
- **Decision log** from the side panel, `/decision`, or the message `Decision` button
- **Task list** with automatic task assignment from actionable `@mentions`
- **Manual task command** using `/task @Name task description`
- **Task completion / reopen** from the Tasks panel
- **Live rolling summary** and **What did I miss?** button
- **Input sanitization** to reduce HTML/script injection risk
- **No database required** for testing; records are stored in a JSON file

## Project Structure

```text
real-time-meeting-discussion/
├── server.js
├── package.json
├── package-lock.json
├── data/
│   └── .gitkeep               # discussions.json is created automatically
├── uploads/
│   └── .gitkeep               # shared files / images / voice notes are saved here
├── render.yaml                # Render deployment configuration
└── public/
    ├── index.html
    ├── style.css
    └── script.js
```

## Requirements

- Node.js 16+; Node.js 18+ is recommended
- npm
- A modern browser for voice notes. Chrome or Edge is recommended.

## Setup and Run

1. Open the project folder in VS Code or terminal.

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the server:

   ```bash
   npm start
   ```

   For development with auto-restart:

   ```bash
   npm run dev
   ```

4. Open the app in your browser:

   ```text
   http://localhost:3000
   ```

5. To test real-time behavior, open the same URL in two browser tabs, join the same discussion room with different names, and send messages.

## How to Use the Features

### 1. Project-linked meeting

On the join screen, enter:

- Your name
- Project name
- Discussion room
- Meeting template

The app stores the meeting under the room name and links it with the project name.

### 2. Meeting templates

Choose one of these templates before joining:

- Standup
- Retro
- Brainstorm
- Client Call
- General Meeting

The template agenda appears in the right-side meeting panel.

### 3. Mention someone

Use this format:

```text
@Calvin please review the uploaded document.
```

You can also click a username in the online list to insert the mention automatically.

### 4. Reply to a message

Move your mouse over a message and click **Reply**. The app shows a reply preview above the input box.

### 5. Emoji and live reactions

- Use the **Emoji** button to insert emojis into your message.
- Use the reaction buttons under a message to react with 👍 ❤️ 😂 🎉 ✅ 👀.

### 6. Voice notes

Click **Voice note** to start recording. Click **Stop recording** to send the voice note into the discussion.

Voice notes are saved in the `uploads/` folder.

### 7. Share documents and images

Click **Share file** and choose an image, PDF, Word document, spreadsheet, PowerPoint, text file, or audio file.

Uploaded files are saved in:

```text
uploads/
```

The maximum upload size is **10MB**.

### 8. Decision log

You can create decisions in three ways:

1. Type a command in chat:

   ```text
   /decision We will use PostgreSQL for deployment.
   ```

2. Click the **Decision** button under a message.

3. Add a decision manually from the Decision Log panel.

### 9. Tasks from @mentions

The app automatically creates tasks when a message mentions someone and looks actionable.

Example:

```text
@Calvin please prepare the meeting notes by tomorrow.
```

This creates a task assigned to `@Calvin`.

You can also create a task manually with:

```text
/task @Calvin prepare the deployment checklist
```

### 10. Live summary and What did I miss?

The right panel shows a live rolling summary of the meeting. Click **What did I miss?** to get a short summary of what changed since you last left the room. If it is your first time joining, it summarizes the current room history.

This version uses a local AI-style summary generator, so it works without API keys. A future version can connect this to OpenAI, Gemini, or another AI API for stronger summaries.

### 11. Download transcript and recap

Use the sidebar buttons:

- **Download transcript** — downloads a plain text record of the meeting.
- **Download recap** — downloads a Markdown recap with project, summary, decisions, tasks, and transcript.

The recap file can be uploaded to Google Drive or copied into Google Docs.

## About Google Docs / Drive Integration

The app currently exports a Google Docs / Drive-ready Markdown recap. Directly pushing to Google Docs or Google Drive requires Google OAuth credentials and extra setup.

Recommended next upgrade:

- Add Google OAuth login
- Request Drive/Docs permissions
- Create a Google Doc from the generated recap
- Optionally upload shared files into a project folder in Google Drive

## Important Notes

This project uses JSON file storage to keep it simple and easy to run. For a deployed production version, upgrade storage to MongoDB, PostgreSQL, Firebase, or Supabase.

On free hosting, local JSON records and uploaded files may be temporary. For long-term deployed storage on Render, attach a persistent disk and set:

```text
DATA_DIR=/var/data/data
UPLOADS_DIR=/var/data/uploads
```

The app listens on:

```js
process.env.PORT || 3000
```

So it can be deployed to platforms like Render, Railway, Fly.io, or a VPS.

## Deploy on Render

1. Push this project to GitHub.
2. Open Render and create a new **Web Service**.
3. Connect your GitHub repository.
4. Use these settings:

   ```text
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   ```

5. Deploy the service.
6. Open the Render URL and test with two browser tabs.

## Resume Project Name

**Real-Time Meeting Discussion** — a full-stack real-time meeting workspace using Node.js, Express, Socket.IO, and vanilla JavaScript, with project-linked rooms, saved transcripts, user mentions, replies, live emoji reactions, voice notes, file sharing, decision logs, auto-generated tasks, live summaries, and downloadable meeting recaps.
