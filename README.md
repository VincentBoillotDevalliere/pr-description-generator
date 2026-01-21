# 🚀 PR Description Generator (AI-Powered)

<img src="https://raw.githubusercontent.com/VincentBoillotDevalliere/pr-description-generator/main/assets/image.png" alt="PR Description Generator Logo" width="128" height="128">

### Write **better PR descriptions in seconds** — powered by Git analysis **and AI**

Stop wasting time explaining your changes.  
This VS Code extension turns your Git diffs into **clear, structured, reviewer-friendly pull request descriptions** — instantly.

Use it locally, or **supercharge it with AI** for next-level summaries, explanations, and polish — *without leaking secrets*.

---

## ✨ Why you’ll love it

- 🧠 **AI-enhanced PR descriptions** (optional, safe, and configurable)
- ⚡ Generate PRs directly from **staged changes** or **base branch diffs**
- ✍️ Insert the result straight into your editor
- 🔒 Built-in **secret redaction** before any AI call
- 📋 Clean, ready-to-paste **Markdown output**
- 🛠 Designed for fast, repeatable, professional PR workflows

This is the tool you wish GitHub had built.

---

## 🧩 Features

- ✅ Generate PR descriptions from **staged changes**
- ✅ Generate PR descriptions **against a base branch**
- 🤖 **AI-powered enhancement** (opt-in)
- 🔐 Automatic redaction of secrets before AI requests
- 🧾 Preview the exact AI prompt before sending
- ✏️ Insert directly into the active editor
- 📎 Optional clipboard copy
- 🧼 Clean, structured Markdown output
- 🔁 Graceful fallback to local generation if AI is unavailable

---

## 🎮 Commands

Open the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`):

### Generate from staged changes
```
PRD: Generate PR Description (staged)
```

---

### Generate against a base branch
```
PRD: Generate PR Description (against base branch)
```

---

### 🤖 Generate AI-enhanced description
```
PRD: Generate PR Description (AI enhanced)
```

---

### Insert at cursor
```
PRD: Insert PR Description Here
```

---

## ⚙️ Configuration

### Base

```json
"prd.baseBranch": "main",
"prd.maxDiffLines": 2000,
"prd.copyToClipboard": true,
"prd.includeFilesSection": true
```

---

## 🤖 AI Configuration

```json
"prd.ai.apiKey": "YOUR_API_KEY",
"prd.ai.provider": "openai",
"prd.ai.endpoint": "https://api.openai.com/v1/chat/completions",
"prd.ai.model": "gpt-4o-mini",
"prd.ai.timeoutMs": 12000
```

---

## 🔒 Privacy & Safety

AI is **100% opt-in** and protected by automatic redaction.

---

## 📄 License

MIT
