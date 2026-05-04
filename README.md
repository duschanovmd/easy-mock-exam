# CAU Mock Exam Portal

A simple classroom mock MCQ testing portal for Central Asian University Medical School.

This is a practice prototype, not an official secure exam platform. Students enter only a nickname. No real names, IDs, emails, or other identity fields are collected.

## Run

```bash
npm start
```

Open:

- Student portal: `http://localhost:3000/#/student`
- Professor dashboard: `http://localhost:3000/#/professor`

Default professor passcode:

```text
CAU-MED
```

To change it:

```bash
PROFESSOR_PASSCODE=your-passcode npm start
```

When using a public tunnel while keeping the professor dashboard open on localhost, start the server with `PUBLIC_BASE_URL` so QR codes and copied student links use the public address:

```bash
PUBLIC_BASE_URL=https://your-tunnel.trycloudflare.com npm start
```

## Classroom Use

1. Open the professor dashboard.
2. Set the duration and confirm the exam code.
3. Add questions manually, or import JSON/CSV.
4. Preview imported questions before replacing the exam set.
5. Share the QR code, student link, and exam code.
6. Students join with nicknames only.
7. Press `Start exam`.
8. Students submit early or are submitted automatically when time ends.
9. The exam ends only when the professor ends it or the timer reaches zero.
10. Students see their own score. Per-question explanations appear only when enabled for the session and the exam has ended.
11. Class analytics appear only on the professor dashboard after the exam ends.
12. Export the results CSV from the professor dashboard when you want a saved record.

Students can use `Exit room` to leave a waiting room or active mock exam and return to the join screen. Waiting/answering students are removed from the professor participant list. Submitted results remain available for professor analytics.

If a student refreshes or accidentally closes the page, they can re-enter the same exam code and nickname to reconnect to the same mock attempt.

Multiple mock exams can run at the same time. Each professor session has its own exam code, and students must enter the correct code to join that specific room. The copied student link includes the exam code for convenience.

Each exam session also has its own professor passcode shown in the dashboard. The global prototype passcode can still open the dashboard, but regenerating the session passcode gives that room a cleaner private control code. Old ended sessions can be cleared from the professor dashboard without deleting the currently selected session.

Professor controls per student:

- `Reset` clears a student's answers/result and lets them answer again.
- `Remove` deletes the student from that session.
- Live status shows how many questions each student has answered.

## Question Import

In the professor dashboard, set:

- `Questions in template`
- `Choices per question`

Then use `Download CSV template` or `Download JSON template`. The downloaded file will match those settings.

Ready-made static 20-question examples are also included:

- `public/templates/cau-mcq-template-20.csv`
- `public/templates/cau-mcq-template-20.json`

CSV headers:

```csv
question,A,B,C,D,E,correctAnswer,explanation
"Which vitamin deficiency causes scurvy?","Vitamin A","Vitamin B12","Vitamin C","Vitamin D","Vitamin E","C","Vitamin C deficiency impairs collagen synthesis."
```

Use as many choice columns as selected in the dashboard, from `A/B` up to `A/B/C/D/E/F`.

Pasted CSV/JSON can be checked with `Preview import`. The dashboard shows total rows, valid rows, missing explanations, and row-specific errors. `Import previewed` is enabled only when the preview is valid.

Uploaded CSV/JSON files are previewed and imported automatically when valid. If the file has errors, the dashboard keeps the preview visible so the rows can be fixed before importing.

JSON:

```json
[
  {
    "question": "Which chamber pumps blood into the pulmonary artery?",
    "A": "Left atrium",
    "B": "Right ventricle",
    "C": "Left ventricle",
    "D": "Right atrium",
    "correctAnswer": "B",
    "explanation": "The right ventricle pumps deoxygenated blood to the lungs."
  }
]
```

## Notes

- Realtime synchronization uses server-sent events from the local Node server.
- Exam state is saved in `data/exam-state.json`.
- The professor passcode is a prototype gate, not production authentication.
- For a classroom, run the server on the professor machine and share the machine's local network address with students.
