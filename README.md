# STUDENT THANWA OS

A public-facing student learning web app with a Node.js/Express backend, SQLite accounts/essays, and Groq-powered AI Tutor.

## Requirements
- Node.js 20+
- A Groq API key
- A persistent disk/volume for SQLite when deployed

## Run locally
1. Install Node.js 20 or newer.
2. In this folder run: `npm install`
3. Copy `.env.example` to `.env`.
4. Put your Groq key in `GROQ_API_KEY` in `.env`.
5. Replace `JWT_SECRET` with a long random secret (at least 32 characters).
6. Run: `npm start`
7. Open `http://localhost:3000`.

## Deploy
Deploy this folder as a Node.js web service. Build command: `npm install`. Start command: `npm start`.
Set environment variables in the hosting dashboard:
- `GROQ_API_KEY`: your private Groq key
- `JWT_SECRET`: a long random secret
- `GROQ_MODEL`: a model currently enabled for your Groq account
- `DAILY_QUESTION_LIMIT`: for example `20`
- `DATA_DIR`: path to a mounted persistent volume, for example `/data`

**Important:** Attach a persistent disk/volume and set `DATA_DIR` to its mount path. Without persistent storage, SQLite accounts and essays may be lost when the host replaces the instance. Never put the API key in `public/index.html`, commit `.env`, or share it with users.

## Included
- Email/password registration and login
- JWT authentication
- Profile and education level
- Thai/English interface setting
- Light/dark theme
- Groq AI Tutor with daily per-account usage limit
- Essay storage per account
- Calculator and sample exam
- Basic API and authentication rate limits

## Production checklist
- Configure HTTPS on your host.
- Use a persistent volume for SQLite.
- Set a strong unique JWT_SECRET.
- Set a suitable daily question limit and monitor Groq usage.
- Add email verification, password reset, moderation, backups, and stronger abuse controls before a large public launch.
- Check Groq's current model availability and set GROQ_MODEL accordingly.
