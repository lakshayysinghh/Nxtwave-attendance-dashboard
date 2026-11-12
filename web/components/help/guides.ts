/**
 * Help content for every page, in one place so it is easy to update when a
 * feature changes. It only describes the app; no rule is applied here.
 *
 * Strings may use **bold** and `code`. A section, line or table row with
 * `roles` is shown only to those roles, so a guide never offers an action
 * that the reader's role is not allowed to do (the API checks it again).
 */

export type Role = "owner" | "admin" | "student";
export type Line = string | { text: string; roles: Role[] };
export type Row = [string, string] | { cells: [string, string]; roles: Role[] };
export type Section = {
  title: string;
  text?: string;
  points?: Line[];
  steps?: Line[];
  table?: { head: [string, string]; rows: Row[] };
  roles?: Role[];
};
export type Guide = { title: string; summary: string; roles?: Role[]; sections: Section[] };

const OWNER: Role[] = ["owner"];
const ADMIN_ONLY: Role[] = ["admin"];

export const guides = {
  overview: {
    title: "Overview",
    summary: "The management summary for a term.",
    sections: [
      { title: "What this page is for", text: "A quick picture of the whole cohort for one term: how many students, the average attendance, how many are in each band, and who needs attention first." },
      {
        title: "On this page",
        table: {
          head: ["Part", "What it shows"],
          rows: [
            ["Line under the title", "The term and its dates, and **data up to**: the last day included in the numbers"],
            ["**Term** picker", "Switch to a past or future term; every number on the page follows"],
            ["**Students**", "Students listed, and how many have **no marks yet**"],
            ["**Average attendance**", "The average of the students' own percentages. Students with no marks are left out."],
            ["**Band cards**", "For each band: its share of the students with marks, and the count. Click a card to open those students."],
            ["**Students needing attention**", "Up to 6 students below 75%, lowest first, with links to see all of them"],
            ["**System status**", "Folded at the bottom: whether the server and database are reachable"],
          ],
        },
      },
      {
        title: "Colours",
        table: {
          head: ["Colour", "Band"],
          rows: [
            ["Red", "**Below 60%**"],
            ["Amber", "**60% – 75%** (75% itself is green)"],
            ["Green", "**75% and above**"],
          ],
        },
      },
      {
        title: "Quick actions",
        points: ["**Mark attendance** opens daily marking.", "**Import students** and **Import attendance** open the matching tab of Imports."],
      },
      {
        title: "Good to know",
        points: [
          "Attendance % = Present ÷ (Present + Absent). Days not marked are left out, never counted as absent.",
          "Dropped students are included in the counts; their % stops at the drop date.",
          "Demo students (NIAT IDs starting `N99`) are included and carry a **Demo** badge.",
        ],
      },
      {
        title: "Common problems",
        table: {
          head: ["You see", "Why / what to do"],
          rows: [
            ["**No current term**", "Open **Terms** and set a term as current."],
            ["Average shows **–**", "No student has marks in this term yet. Mark attendance or import a sheet."],
            ["Numbers look old", "Check **data up to**: future days never count, and days after the term ends are not included."],
          ],
        },
      },
    ],
  },

  students: {
    title: "Students",
    summary: "Search, filter, add and remove students.",
    sections: [
      { title: "What this page is for", text: "Every student with their attendance for the chosen term. Find a student, open their full record, or add a new one." },
      {
        title: "The table",
        table: {
          head: ["Column", "Meaning"],
          rows: [
            ["**Days present / Days absent**", "Counted days marked Present or Absent"],
            ["**Working days**", "Days that count for this student so far"],
            ["**Attendance**", "The %, coloured by band; **No marks yet** when nothing is marked"],
            ["**(dropped)**", "The student has left; their history is kept"],
            ["**Demo**", "Test data with a NIAT ID starting `N99`"],
          ],
        },
      },
      {
        title: "Search, filters and controls",
        points: [
          "**Search** matches part of a name or the start of a NIAT ID.",
          "**Degree**, **Section** and **Hall** (including No hall) narrow the list. Section choices follow the chosen degree.",
          "Click a **band card** to show only that band; click it again to undo.",
          "**Clear filters** resets everything. The line under the filters shows how many students are shown out of the total.",
          "The **Term** picker shows percentages for any term.",
          "Filters live in the page address, so **Back** from a student returns to the same list, and you can share the link with another admin.",
        ],
      },
      {
        title: "Add a student",
        steps: [
          "Click **Add student**.",
          "Fill in **NIAT ID**, **Full name**, **Degree** and **Section**. Level, Hall, POC, Success coach and Joined On are optional.",
          "Save. A NIAT ID must look like `N24H01A0598` or `N24H01B0225`, and an existing NIAT ID is refused.",
        ],
      },
      { title: "Many students at once", text: "To add or update many students, use **Imports → Import students** instead." },
      {
        title: "Bulk delete",
        roles: OWNER,
        steps: [
          "Tick students one by one, or tick the box in the table header to select **every student shown**. Ticks are kept when you change the search.",
          "Click **Delete selected…** in the red bar.",
          "Check the NIAT IDs, type `DELETE <number>` exactly (for example `DELETE 37`) and confirm.",
        ],
      },
      {
        title: "Good to know",
        points: [
          { text: "Bulk delete is **permanent**: the students and all their marks, remarks and periods go. For a real student who left, open them and use **Remove → Mark as dropped**.", roles: OWNER },
          { text: "Only the Owner can permanently delete students. To stop counting a student who left, open them and use **Remove → Mark as dropped**.", roles: ADMIN_ONLY },
          "The band cards always show the whole cohort; the table follows your filters.",
        ],
      },
      {
        title: "Common problems",
        table: {
          head: ["Problem", "What to do"],
          rows: [
            ["A student is missing", "Click **Clear filters**. A NIAT ID search matches only the start of the ID."],
            ["**No marks yet**", "Nothing is marked for them in this term; check the **Term** picker."],
            ["\"A student with NIAT ID … already exists\"", "Search for that ID and edit the existing student instead."],
          ],
        },
      },
    ],
  },

  "student-page": {
    title: "Student record",
    summary: "One student's full record, internships and registration.",
    sections: [
      { title: "What this page is for", text: "Everything the student sees on their own page, plus admin details and controls: placement cautions, internship and registration periods, the monthly summary and a day-by-day calendar." },
      {
        title: "Buttons at the top",
        table: {
          head: ["Button", "What it does"],
          rows: [
            ["**Term**", "This student's numbers for any term"],
            ["**Back**", "Returns to the Students list with its filters"],
            ["**Edit**", "Change any field except the NIAT ID. A new POC or Success coach name is created automatically."],
            { cells: ["**Remove**", "**Mark as dropped** (keeps history) or **Delete permanently** (type the NIAT ID to confirm)"], roles: OWNER },
            { cells: ["**Remove**", "**Mark as dropped** with a date (keeps history; undo with Edit). Permanent delete is for the Owner only."], roles: ADMIN_ONLY },
            ["**Mark attendance**", "Opens daily marking"],
          ],
        },
      },
      {
        title: "Placement cautions",
        points: [
          "Placements need **at least 95%**, for the term and in every month.",
          "Below 95%, a red **Caution** says how many class days in a row without an absence are needed to reach 95%.",
          "Each month shows **OK**, **Below 95%: caution** or **No marks**.",
          "Click **Add remark** (or **Edit remark**) next to a month, type up to 500 characters and save. Saving it empty removes it. **The student sees remarks.**",
        ],
      },
      {
        title: "Internship and registration",
        table: {
          head: ["Label", "Meaning"],
          rows: [
            ["**Internship Period** (violet)", "Days saved as **Present**. From imports, or assigned here."],
            ["**Term 5 Registration Pending** (orange)", "Days saved as **Absent**. From imports only; no buttons here."],
            ["Upcoming, In progress, Ended", "Internship states"],
            ["Still pending, Completed", "Registration states. Completed shows the date registration was done."],
            ["Cancelled", "A cancelled internship, kept as history (students never see it)"],
          ],
        },
      },
      {
        title: "Assign an internship",
        steps: [
          "Click **Assign internship** (shown for active students).",
          "Pick the **First day** and **Last day** (at most 366 days).",
          "Click **Check days**. Nothing is saved yet: it shows how many days will be marked Present and which already have marks.",
          "Existing marks are kept unless you tick **Overwrite these with Present (Internship)**.",
          "Click **Assign internship**.",
        ],
      },
      {
        title: "Change an internship",
        points: [
          "**Edit / extend**: change the dates → **Check days** → **Save changes**. Removed days lose their internship marks.",
          "**End today**: the same form with the last day set to today.",
          "**Cancel**: removes the internship's Present marks and keeps the period as Cancelled.",
        ],
      },
      {
        title: "Monthly summary and calendar",
        points: [
          "**Monthly summary**: counted days, present, absent and % per month. Click a month to show it in the calendar.",
          "**Attendance calendar**: P (green) and A (red), holidays, exam days, Sundays and internship / registration-pending days in their colours.",
          "**Hover over or tap a date** to see its type, label, whether it counts, the mark and its period.",
        ],
      },
      {
        title: "Common problems",
        table: {
          head: ["Problem", "Why / what to do"],
          rows: [
            ["\"This student already has an internship from … to …\"", "A student can have only one internship at a time. Edit or cancel the existing one."],
            ["No **Assign internship** button", "The student is dropped. Dropped students cannot get an internship."],
            ["A day has a mark but the % ignores it", "That day does not count: a holiday, exam, Sunday, before joining or outside the term."],
          ],
        },
      },
    ],
  },

  attendance: {
    title: "Mark Attendance",
    summary: "Daily marking for one hall on one day.",
    sections: [
      { title: "What this page is for", text: "Marking each student of one hall **Present** or **Absent** for a day. One mark per student per day; saving again replaces it." },
      {
        title: "Mark a day",
        steps: [
          "Pick a **hall**. The number on each button is its active students.",
          "Check the **Date**. It starts at today; future dates cannot be picked.",
          "Click **Mark all present**, then switch the absent students to **Absent**.",
          "Click **Save (n)**. Changed rows stay highlighted until saved.",
        ],
      },
      {
        title: "Controls",
        table: {
          head: ["Control", "What it does"],
          rows: [
            ["**Present / Absent / Not marked**", "Per student. **Not marked** clears a saved mark."],
            ["**Mark all present**", "After a search it reads **Mark N shown present** and marks only the students shown"],
            ["**Undo changes**", "Discards changes not saved yet"],
            ["**Search**", "Narrows the list by name or NIAT ID. Changes to hidden students are kept and saved."],
          ],
        },
      },
      {
        title: "Good to know",
        points: [
          "Only **active** students are listed; dropped students are not.",
          "Names open in a new tab, so your unsaved marks stay here.",
          "The page warns you before leaving, or changing hall or date, with unsaved changes.",
          "Changing an internship day from Present to Absent turns it into an ordinary mark.",
        ],
      },
      {
        title: "Common problems",
        table: {
          head: ["You see", "Why"],
          rows: [
            ["A yellow banner: cannot be marked", "The date does not count: a Sunday, holiday, exam, exam preparation, non-counting event or outside the term. Pick another date, or change the day on **Calendar**."],
            ["A grey reason instead of buttons", "That day does not count for that student, for example before they joined."],
            ["A student is missing", "They are in another hall, have no hall (use **No hall**), or are dropped."],
          ],
        },
      },
    ],
  },

  imports: {
    title: "Imports",
    summary: "Upload students with attendance, attendance only, or calendar days.",
    sections: [
      {
        title: "What this page is for",
        text: "Saving many records from an Excel (`.xlsx`) or `.csv` sheet. **Import students** saves students and their daily marks in one upload; **Import attendance** saves marks for existing students; **Import calendar** saves holidays, exams and other days.",
      },
      {
        title: "Every import, step by step",
        steps: [
          "Pick the tab, then choose a file (up to 10 MB). For a Google Sheet: *File → Download → Microsoft Excel*.",
          "Click **Check file** (on Import attendance: **Preview**). **Nothing is saved yet.**",
          "Read the preview: counts, each row's result, errors and warnings.",
          "Fix the sheet, or tick **Skip the rows and columns with errors and import the rest**.",
          "Confirm. All of it is saved together; if anything fails, nothing is saved.",
        ],
      },
      {
        title: "Student sheet columns",
        table: {
          head: ["Column", "Notes"],
          rows: [
            ["**NIAT ID**", "Required. `N` + 2 digits + `H` + 2 digits + A or B + 4 digits"],
            ["**Student Name**, **Degree**, **Section**", "Required. Degree is `BITS` or `CDU`."],
            ["Hall No., Level, Instructor Assigned / POC, Joined On", "Optional. A blank cell keeps the saved value."],
            ["One column per date", "For example `19-Aug-2026`. Number dates are day first: `12-08-2026` is 12 August."],
          ],
        },
      },
      {
        title: "Values in date cells",
        table: {
          head: ["Value", "Saved as"],
          rows: [
            ["`Present`, `P`, `1`", "Present"],
            ["`Absent`, `A`, `0`", "Absent"],
            ["`Internship Period`", "Present, tagged Internship (violet)"],
            ["`Term 5 Registration Pending`", "Absent, tagged Registration pending (orange)"],
            ["Empty", "Nothing changes"],
            ["Anything else (`#REF!`, `Leave`…)", "**Not saved**, and listed in the preview"],
          ],
        },
      },
      {
        title: "Reading the preview",
        points: [
          "**Categories recognised**: internship and registration cells, and the periods each student gets (New, Extended, No change).",
          "**Not saved**: unsupported values. Map each to Present, Absent or skip, then **Apply mapping and re-check**, or use **Continue with valid data**.",
          "**Columns not read**: headers that are neither a date nor a known column.",
          "An unreadable date header gets a date picker; it is read only after **Use this date**.",
          "**Dates with no column**: you may save them as Holiday, Exam or Exam preparation. Save only days that really had no class.",
        ],
      },
      {
        title: "Calendar sheet",
        points: [
          "Columns: **Date**, **Day Type** (`Working`, `Holiday`, `Exam`, `Exam Preparation`, `Event`), **Applies To** (`All`, `BITS`, `CDU`), **Label**, optional **Counts** (Yes/No, events only).",
          "A row for a date and scope that already has an entry replaces it. Marks are never deleted.",
        ],
      },
      {
        title: "Good to know",
        points: ["Uploading the same file twice changes nothing.", "Phone number columns are ignored and never stored.", "Each tab has **Download sample CSV** with a ready-made example."],
      },
      {
        title: "Common problems",
        table: {
          head: ["Message", "What to do"],
          rows: [
            ["\"Skipped: … is a holiday\"", "That date is saved as a holiday. If it was a class day, remove it on **Calendar** and import again."],
            ["\"NIAT ID … was not found\"", "On Import attendance the student must exist. Use **Import students** instead."],
            ["\"… does not match the expected format\"", "Check the NIAT ID, for example `N24H01B0225`."],
            ["A date column was ignored", "It is in the future, appears twice, or its header is not a date."],
          ],
        },
      },
    ],
  },

  calendar: {
    title: "Calendar",
    summary: "Holidays, exams, exam preparation, events, working days and internships.",
    sections: [
      {
        title: "What this page is for",
        text: "Deciding which days count. Monday to Saturday are working days and Sundays are off unless you add an entry. An entry applies to **All degrees**, **BITS only** or **CDU only**; a degree's own entry wins over an All entry.",
      },
      {
        title: "Colours and labels",
        table: {
          head: ["Cell", "Meaning"],
          rows: [
            ["White", "Working day (counts)"],
            ["Grey: **Holiday**", "Not counted"],
            ["Amber: **Exam**", "Not counted"],
            ["Rose: **Exam preparation**", "Not counted, e.g. prep leave"],
            ["Blue: **Event**", "Counts unless it shows **Not counted**"],
            ["Light grey: **Sunday**", "Off unless made a working day"],
            ["Faded, **Outside term**", "Never counts"],
            ["\"BITS: Holiday\" in small text", "An entry for another degree than the view"],
            ["Violet \"N in internship\"", "Students on internship that day"],
          ],
        },
      },
      {
        title: "Controls",
        points: [
          "**‹ ›** changes the month. Today has an outline.",
          "**View as** (All, BITS, CDU) shows the days as that degree sees them.",
          "**Hover over or tap a date** for details: each degree's result, every saved entry and the students on internship.",
        ],
      },
      {
        title: "Change days",
        steps: [
          "Click a day, or two days for a range (or type **From** and **To** in **Edit days**).",
          "Choose **Applies to**: All degrees, BITS only or CDU only.",
          "Choose **Day type**: Holiday, Exam, Exam preparation, Event (tick or untick **Counts toward attendance**) or Working (e.g. a make-up Sunday).",
          "Add an optional **Label**, e.g. Diwali.",
          "Tick **Include Sundays in the range** to put an entry on a Sunday.",
          "Click **Save**. **Remove … entries** returns the days to the default rule.",
        ],
      },
      { title: "Example", text: "CDU has class on 26 Sep but BITS has prep leave: select 26 Sep → **BITS only** → **Exam preparation** → label \"Exam prep leave\" → **Save**. CDU stays a working day." },
      {
        title: "Internships table",
        text: "Below the calendar, every internship in the month with its student, dates and status. Tick **Only students in internship today** to see who is on internship now. Internships are assigned on the student's page.",
      },
      {
        title: "Manage entries tab",
        points: [
          "Lists **every saved entry** as date ranges: title, type, Applies to, source, the uploaded file and upload number, and when and by whom it was created and last updated.",
          "**Source** is Manual entry, Calendar import, Attendance import or Students import (dates with no column saved from that sheet).",
          "**Legacy / Source unavailable** means the entry was saved before sources were recorded. Its file, times and admin are unknown and are not guessed.",
          "Filter by degree, type, source, upload, entry dates, or the date it was created or last updated. Search finds titles, file names and admins.",
          "Click an entry's **title** for all its details. **Edit** corrects the type or label in place; the entry then counts as a manual entry, so an imported-entry reset no longer removes it.",
        ],
      },
      {
        title: "Delete entries",
        steps: [
          "Tick one or more entries (the header box ticks every entry shown), or open one and click **Delete…**.",
          "Click **Delete selected (n)**. The preview lists the exact entries, their dates, degrees and types, and the **Effect on attendance**: which dates start or stop counting and how many saved marks that touches.",
          "Tick **I have checked these entries** and click **Delete**.",
          "Deleted entries go to the **Deletion log**, where **Restore** puts them back.",
        ],
      },
      {
        title: "Reset imported entries",
        roles: OWNER,
        steps: [
          "In **Manage entries**, click **Reset imported entries…** (or **Remove these entries…** on an upload in Import history).",
          "Leave everything empty to remove **all imported entries**, or pick uploads, degrees, types and a date range.",
          "Click **Preview what will be removed** and check the exact entries and the effect on attendance.",
          "Type `RESET <number>` and confirm.",
        ],
      },
      {
        title: "Deletion safeguards",
        points: [
          "A reset only removes entries from sheet imports. **Manual and legacy entries are never removed by a reset**; delete them by selecting them.",
          { text: "Resetting imported entries, and restoring a reset, is for the Owner.", roles: ADMIN_ONLY },
          "Students, attendance marks, internships and registration-pending periods are never deleted or changed. Percentages update straight away.",
          "If the calendar changes between the preview and the confirmation, nothing is deleted and you are asked to check again.",
          "**Deletion log** shows who deleted what and when. **Restore** puts entries back with their original details, except where a newer entry now uses the same date and degree.",
        ],
      },
      {
        title: "Import history tab",
        points: [
          "One row per saved upload that wrote calendar entries: file, upload time and admin, entries created and updated, date range, degrees and status.",
          "**View entries** opens Manage entries filtered to that upload.",
          "**None now: changed or removed later** means a later save replaced or removed every entry from that upload.",
          "Uploads from before this history was added are not listed.",
        ],
      },
      {
        title: "Good to know",
        points: ["Calendar changes never delete marks; they only change whether marks count.", "Save warns when some dates already have marks.", "**Remove … entries** removes only the entries for the chosen **Applies to**."],
      },
      {
        title: "Common problems",
        table: {
          head: ["Problem", "What to do"],
          rows: [
            ["Class days show as holidays", "In **Manage entries**, filter by type Holiday (and by upload if known), tick the wrong ones and click **Delete selected**. Their saved marks count again at once."],
            ["Old wrong holidays show as Legacy", "They were saved before sources were recorded, so a reset does not match them. Tick them in **Manage entries** and delete them."],
            ["A Sunday did not save", "Tick **Include Sundays in the range**."],
            ["One degree changed when both should", "Use **All degrees**, or remove the degree's own entry, which wins over All."],
          ],
        },
      },
    ],
  },

  terms: {
    title: "Terms",
    summary: "Semesters and the current term.",
    sections: [
      { title: "What this page is for", text: "Setting semester dates. Attendance counts **only inside a term**, and the **current term** is used for every percentage and shown to students." },
      {
        title: "Labels",
        table: {
          head: ["Label", "Meaning"],
          rows: [
            ["**Current term**", "The term used for percentages and the student view"],
            ["Upcoming / In progress / Ended", "Where today falls compared with the term's dates"],
          ],
        },
      },
      {
        title: "Start a new semester",
        steps: [
          "In **Create term**, enter a name, start date and end date (for example Sem 2: 4 Jan 2027 to 15 May 2027).",
          "Tick **Make this the current term**, or later click **Set as current**.",
          "Add holidays on **Calendar**, then import the student sheet.",
        ],
      },
      {
        title: "Good to know",
        points: [
          "Terms cannot overlap, and a term is at most about a year long.",
          "A term cannot be unset; set another term as current instead.",
          "**Delete** acts at once, with no confirmation. A term with attendance marks cannot be deleted.",
          "Overview, Students and student pages have a **Term** picker for other terms; students always see the current term.",
        ],
      },
      {
        title: "Common problems",
        table: {
          head: ["Problem", "Why"],
          rows: [
            ["\"These dates overlap another term.\"", "Move the dates so the terms do not share any day."],
            ["Delete is refused", "The term has attendance marks."],
            ["Days show **Outside term**", "They are between terms. Extend the term's dates if they should count."],
          ],
        },
      },
    ],
  },

  admins: {
    title: "Manage admins",
    summary: "Admin accounts, passwords and Owners.",
    roles: OWNER,
    sections: [
      { title: "What this page is for", text: "Creating and managing the accounts that sign in to the admin portal. Instructors and POCs get a regular admin account." },
      {
        title: "Labels",
        table: {
          head: ["Label", "Meaning"],
          rows: [
            ["**Owner** / **Admin**", "Owners can also delete students and manage admins"],
            ["**Deactivated**", "Cannot sign in; their saved work stays"],
            ["**Must change password**", "Will choose their own password at next sign-in"],
            ["**No password set**", "The account has no password yet; use **Reset password**"],
            ["**(you)**", "Your own account"],
          ],
        },
      },
      {
        title: "Add an admin",
        steps: ["In **Create admin**, enter name, email and an initial password.", "Click **Create admin**.", "Share the password privately. They choose their own at first sign-in."],
      },
      {
        title: "Buttons per account",
        table: {
          head: ["Button", "What it does"],
          rows: [
            ["**Edit**", "Change name or email. Changing the email signs them out."],
            ["**Reset password**", "Sets a new initial password and signs them out"],
            ["**Deactivate / Activate**", "Blocks or allows sign-in"],
            ["**Make Owner / Make regular admin**", "Making an Owner needs your own password"],
            ["**Delete**", "Removes the account; their marks and imports stay"],
          ],
        },
      },
      {
        title: "Good to know",
        points: ["At least one active Owner must remain: the last one cannot be deactivated, demoted or deleted.", "You cannot delete yourself.", "Only active admins can be made Owner."],
      },
    ],
  },

  "student-view": {
    title: "Check your attendance",
    summary: "The read-only page where students see their attendance.",
    sections: [
      {
        title: "What this page is for",
        text: "Seeing your DSA attendance for the current term. Type your **exact NIAT ID** (for example `N24H01B0225`) and press **View attendance**. No password is needed, and nothing here can be changed.",
      },
      {
        title: "What you see",
        table: {
          head: ["Part", "Meaning"],
          rows: [
            ["**Attendance %**", "Present ÷ (Present + Absent) on days that count. Days not marked are left out."],
            ["**Working days so far**", "Days that counted for you up to today"],
            ["**Placement cautions**", "Placements need **95%**, overall and every month. A red caution says how many class days in a row you need without an absence."],
            ["**Remark**", "A note from the admins for that month, e.g. medical leave approved"],
            ["**Internship and registration**", "Internship days count as Present; Term 5 registration pending days count as Absent"],
            ["**Monthly summary**", "Days, present, absent and % per month. Select a month to see its calendar."],
          ],
        },
      },
      {
        title: "Calendar colours",
        table: {
          head: ["Colour", "Meaning"],
          rows: [
            ["Green **P**", "Present"],
            ["Red **A**", "Absent"],
            ["Violet", "Internship day (Present)"],
            ["Orange", "Registration pending day (Absent)"],
            ["Grey text", "Not counted: Sunday, holiday, exam, exam preparation, before joining or outside the semester"],
          ],
        },
      },
      { title: "Day details", text: "**Hover over or tap a date** to see what was on that day: the type, the label, whether it counts and your mark." },
      {
        title: "Common problems",
        table: {
          head: ["Problem", "What to do"],
          rows: [
            ["\"No student found\"", "Check the NIAT ID letter by letter. If it is right, ask your POC or the admins."],
            ["Your % looks wrong", "Unmarked days are left out, holidays and exams never count, and registration pending days count as Absent. Ask the admins to check your record."],
          ],
        },
      },
    ],
  },

  login: {
    title: "Admin sign-in",
    summary: "Signing in to the admin portal.",
    sections: [
      { title: "What this page is for", text: "Signing in with the email and password the Owner gave you. Students do not sign in: they use **Student** at the top." },
      {
        title: "First sign-in",
        steps: ["Enter your email and the initial password.", "Choose your own password: 10 to 72 characters with a letter and a digit, not containing your email name or a common word like \"password\"."],
      },
      {
        title: "Common problems",
        table: {
          head: ["Message", "What to do"],
          rows: [
            ["\"Invalid email or password\"", "Check both. The same message is shown for every failure."],
            ["Too many attempts", "Wait a minute and try again."],
            ["Forgot your password", "Ask the Owner to use **Reset password**."],
          ],
        },
      },
      { title: "Good to know", points: ["You stay signed in for up to 8 hours.", "**Sign out** signs you out on all your devices."] },
    ],
  },

  rules: {
    title: "How attendance is calculated",
    summary: "The percentage, which days count, bands and the 95% rule.",
    sections: [
      { title: "The percentage", text: "**Attendance % = Present ÷ (Present + Absent) × 100**, rounded to one decimal. Only counted days are included, and a day not marked is left out, never counted as absent." },
      {
        title: "A day counts when",
        steps: [
          "It is inside a term.",
          "It is on or after the student's Joined On date, and on or before the Dropped On date.",
          "It is not in the future (India time).",
          "The calendar makes it a working day: the student's own degree entry first, then an All entry, then Sundays are off, otherwise Monday to Saturday counts.",
        ],
      },
      {
        title: "Day types",
        table: {
          head: ["Type", "Counts?"],
          rows: [
            ["Working", "Always"],
            ["Holiday, Exam, Exam preparation", "Never"],
            ["Event", "Only if **Counts toward attendance** is ticked"],
          ],
        },
      },
      { title: "Bands", table: { head: ["Band", "Range"], rows: [["Red", "Below 60%"], ["Amber", "60% up to 75%"], ["Green", "75% and above"]] } },
      { title: "Placement", text: "Placements need at least **95%** for the term and in every month." },
    ],
  },

  periods: {
    title: "Internship and Registration Pending",
    summary: "Attendance categories and how their periods are built.",
    sections: [
      {
        title: "The two categories",
        table: {
          head: ["Category", "Saved as"],
          rows: [
            ["**Internship Period** (violet)", "Present. From imports, or assigned on the student's page."],
            ["**Term 5 Registration Pending** (orange)", "Absent. From imports only."],
          ],
        },
      },
      {
        title: "Periods from imports",
        points: [
          "Consecutive cells with the same category become one period.",
          "A pending period is completed on the first later date with a normal mark. If the sheet ends while pending, it stays **Still pending**: no date is guessed.",
          "A blank or unsupported cell in the middle splits it into two periods.",
          "A later sheet continues an open period when no counted working day falls in between.",
        ],
      },
      { title: "Where to manage them", text: "Assign, extend, end or cancel internships on the **student's page**. See who is on internship in the **Calendar** page's Internships table." },
    ],
  },

  analysis: {
    title: "Reports and analysis",
    summary: "Where to find answers; there are no downloadable reports.",
    sections: [
      {
        title: "Where to look",
        table: {
          head: ["Question", "Where"],
          rows: [
            ["How is the cohort doing?", "**Overview**: average and band cards"],
            ["Who needs attention first?", "**Overview → Students needing attention**, or click the Below 60% card"],
            ["One section, hall or degree?", "**Students** → filter by Degree, Section or Hall"],
            ["A past semester?", "The **Term** picker on Overview, Students or a student's page"],
            ["Is a student placement-eligible?", "Student's page → **Placement cautions**"],
            ["Who is on internship now?", "**Calendar** → Internships → **Only students in internship today**"],
            ["Whose registration is still pending?", "The student's **Internship and registration** card"],
          ],
        },
      },
      { title: "Not available", points: ["No Excel or PDF exports, and no email or SMS notifications.", "No change history for single marks."] },
    ],
  },

  roles: {
    title: "Who can do what",
    summary: "Students, admins and Owners.",
    sections: [
      {
        title: "Roles",
        table: {
          head: ["Who", "Can"],
          rows: [
            ["**Student** (no sign-in)", "See their own attendance with the exact NIAT ID. Read-only, current term only."],
            ["**Admin**", "Students (add, edit, mark as dropped), marking, imports, remarks, internships, calendar and terms"],
            ["**Owner**", "Everything an admin can, plus permanently deleting students and managing admin accounts"],
          ],
        },
      },
      { title: "Instructors and POCs", text: "They have no separate login type; the Owner gives them a regular admin account." },
    ],
  },
} satisfies Record<string, Guide>;

export type GuideId = keyof typeof guides;

/** Order of the topics on the Help & Guide page. */
export const helpOrder: GuideId[] = ["rules", "roles", "overview", "students", "student-page", "periods", "attendance", "imports", "calendar", "terms", "admins", "analysis", "student-view", "login"];

export const canSee = (g: Guide, role: Role) => !g.roles || g.roles.includes(role);
export const visibleSections = (g: Guide, role: Role) => g.sections.filter((s) => !s.roles || s.roles.includes(role));
