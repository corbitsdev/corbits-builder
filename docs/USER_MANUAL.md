# Builder user manual

Builder turns an idea into a working web app. You describe what you want. A
coordinator talks it through with you and writes short planning documents. A
designer draws the screens. An app builder writes the app. You approve each step
before the next one starts.

This guide follows what you see in the browser, in the order you meet it.

## 1. Sign in and connect a model

### Create an account or sign in

The first screen says **Welcome back**. If you have no account yet, choose
**Create an account** under the form and enter your name, email and a password
of at least eight characters.

### Connect a model provider

Builder runs on AI models from a provider you connect. Until one is connected,
you see **Connect a model provider** with the line "Builder needs one before a
project can start."

- For a subscription, choose **ChatGPT** or **xAI** and finish signing in in
  the new browser tab.
- For an API key, choose **OpenAI**, **Anthropic**, **Google** or **xAI API**,
  paste its key and choose **Test connection**. The key is saved only once the
  test passes.

You can choose **Skip for now** to look around first, but no project can start
without a provider.

Later, manage providers in **Settings → Providers**. Each one shows a status:
**Connected**, **Key refused**, **Not reachable** or **No key**. Keys are kept
encrypted and never shown again. Use **Add provider** to connect another.

You can also sign in with a ChatGPT or xAI subscription instead of a key. Those rows read **Login with
ChatGPT (Subscription)** and **Login with xAI (Subscription)**. Choose **Log
in** and finish signing in in the new browser tab.

### Pick a profile

A profile decides which models do the work. It sets a model and effort for four
tiers (Low, Medium, High and Max), and each role runs on one tier: the
Coordinator, the Writer, the Designer, the App builder and the Reviewer.

Open **Settings → Profiles**:

- Each connected provider has a ready-made profile, such as **Anthropic
  Default**. Choose **Use** to make one your **Active** profile.
- Choose **Details** to see what each tier runs.
- Choose **New profile** to make your own. Pick **Start from** an existing
  profile or **Blank**, give it a **Name**, choose the provider, model and
  effort for each tier, then **Save profile**. Your own profiles can be edited
  and deleted.

A profile whose provider is not connected says "Its provider is not connected,
so a project cannot start on it."

If only one provider is connected, its profile is used automatically. If you
connect more than one, choose an active profile; otherwise a new project cannot
start. Each project keeps the profile it started with.

### Set how Builder works with you

**Settings → Preferences** holds **How Builder works with you**. Each change
saves on its own. What you say in a project's conversation always wins over
these settings.

The defaults come first:

- **How much should Builder ask you?**: Ask only the essentials, Walk me
  through every decision, or Just build it — decide for me.
- **Replies**: Concise or Detailed.
- **Technical detail**: Off keeps everything in plain language.
- **Design concepts to compare**: Three, or One to Five.
- **Nitpicky review**: Off; On makes reviews raise small polish too.
- **Let the agent decide approvals**: Off means you approve each document. On
  lets each document go ahead once it is written.
- **Ask open questions before approval**: On means a document reaches you for
  approval only once its open questions are answered.
- **Install any package without asking**: Off means you approve each new
  package the app builder wants to add.
- **Internet while building**: On lets the app builder download packages and
  reach public websites while it works. Off limits it to the npm registry, so
  it can still install packages.
- **What's next in each project**: Off. On pins a line at the top of each
  project's conversation saying who is working and what you do next.

A project keeps the preferences its creator had when it started; a later
change applies to new projects. **What's next in each project** is the
exception: it changes the line in every project at once.

The same tab also has **Appearance** (light, dark or system theme, and **Show
tips**) and your **Account**, with **Sign out**.

## 2. Start a project

From **New project** in the sidebar you see "What do you want to build today?"

1. Type your idea in the box that says "Describe the thing you want built…". It
   needs at least ten characters. You can also dictate with the microphone.
2. The **Model profile** picker in the box shows the profile the project will
   use. Change it here if you want a different one.
3. Send it. You see "Starting your project…" and then the project opens.

The project has two sides. The conversation is on the left. Documents, designs
and the app appear as tabs on the right.

The coordinator replies first. It welcomes your idea and explains how you will
work together: talk it through, write a short plan you approve, design how it
looks, then build it. Then it asks you questions. How many depends on your
**How much should Builder ask you?** setting.

You can reply in your own words at any time. When a reply ends with a short list
of options, they also appear as buttons above the message box; choose one to
send it.

To share files, use **Attach files** (the paperclip) in the message box. Each
file is filed with the project for the coordinator to read.

## 3. Answer questions

When the coordinator needs several decisions at once, it shows a card titled
**A few questions before going on**, with up to five questions.

- **Single choice**: pick one option from the list.
- **Multiple choice**: tick every option that applies.
- **Other**: when offered, choose it and type in **Your own answer**.

The coordinator's recommended answers are already selected. Change any you
disagree with. **Send answers** turns on once every question has an answer.

After you send, the card shows "Answered:" followed by your answers. If you
reply in the conversation instead, the card says "Answered in the
conversation." If the coordinator asks newer questions first, the old card says
"Replaced by the questions that followed."

## 4. Documents and approvals

### Which documents get written

Documents come in this order. Each one builds on the ones before it.

1. **Brief**: who the app is for, what it must do and what done looks like.
   The coordinator writes it.
2. **Constraints**: the limits, such as budget, devices, data and privacy, and
   what the first version includes. A writer writes it.
3. **Approaches**: two or three ways to build it, with one recommended. A
   writer writes it.
4. **Requirements**: what the app does for whom, built the chosen way. A writer
   writes it.
5. **Design Plan** and **Design Mockup**: the chosen design, as notes and as
   clickable screens. A designer makes it.
6. **Build Plan**: the chosen approach and the order of the work. A writer
   writes it.

Before the constraints are written, the coordinator asks you about the limits
that are yours to decide, such as who can use the app and what you are willing
to spend.

A reviewer may also check a document and advise the coordinator. That review
is advice, never an approval.

### Reading a document

Choose a tab on the right to open a document. A dot on a tab means a new
version you have not opened yet. Hover over a tab to see whether it is
**Drafted** or **Approved**, and at which version.

While reading, you can:

- Select text, or click a passage, and choose **Add to prompt** to quote it in
  your message.
- Use the version menu to open an earlier version, or **Compare with previous**
  to see what changed. **Stop comparing** returns to the normal view.
- Use **Tips** in the bar at the foot of the document for reminders. You can
  turn them off there or in Settings.

To ask for a change, write it in plain words in the conversation.

If you ask to change a document that a specialist is already working from, you
see a warning that it may cost more and restart some of their work. Choose
**Send anyway** or **Cancel**.

### Approving a document

When a document is ready, an approval card appears in the conversation, for
example "Happy with the brief? It's open on the right." It says exactly what you
approve, such as "Approving Weather App Brief v2, written by the Coordinator."
It also says what comes next, such as "Next on approval: Constraints."

- **Yes, go ahead** approves it. The card becomes "Approved · …" and the next
  document starts.
- **Not yet** declines it. The card becomes "Not yet · …" and the cursor moves
  to the message box. Say what should change.

One card can cover several documents. It then reads "Happy with the …?" and
**Covers N documents** lists each one with its version.

While a card is open, typing a plain "yes", "ok", "go ahead" or similar approves
it after a short countdown ("Approving in 3s"). Choose **Undo** to send your
words as an ordinary message instead.

### What approval means

An approval covers one exact version of a document. If the document changes
afterwards, it needs your approval again. The next document's writer starts only
from versions you approved.

By default a document reaches you for approval only once its open questions are
answered (**Ask open questions before approval**). If you turn on **Let the
agent decide approvals**, documents go ahead once written and the coordinator
tells you about each one instead.

## 5. Choose an approach

The **Approaches** document opens with **Approaches side by side**: one card per
approach. Each card shows its name, a summary, the effort (**Low effort**,
**Medium effort** or **High effort**), **Best for**, **Pros**, **Cons** and
**Risks**. One card is marked **Recommended**.

Choose **Choose this one** on the approach you want. This approves that version
of the approaches if it is waiting for your approval, and sends the coordinator
"I choose the … approach." Your pick is marked **Your choice**. If you pick a
different one from the recommendation, the coordinator has the document updated
to record your choice.

## 6. Design

Once the brief, constraints, approaches and requirements exist, the coordinator
checks in. It asks whether you want one design it suggests or to explore
several looks, and whether you have a look in mind: apps you like, colours or a
feel.

### Design themes

Until a design exists, a **Design Themes** tab shows example mockups of each
ready-made look. Open one to click through it and tweak it. **Use this theme**
puts a message such as "Design it in the … theme." in your message box; send it
to design in that theme.

### Starting the design

Before any designer starts, a card asks **Ready to start the design?** and lists
the **Design concepts to compare** it will make.

- **Start the design** lets it begin.
- **Start designs without asking** also lets later design starts in this
  project go ahead without a card.
- **Not yet** stops it so you can say what to change.

If you asked to explore, you get as many concepts as **Design concepts to
compare** says (three by default).

### Comparing concepts

Each concept gets a tab such as **Design mockup 1 · Retro**. A live dot means
its designer is still sketching. The tab shows the draft as it takes shape.

In a mockup you can switch **Screen**, try its states, **Switch light and
dark**, view it as **Desktop** or **Phone**, and **Expand to full screen**.
**Tweak the look** opens **Primary colour**, **Background**, **Corner radius**
and **Font**. **Save these** keeps your tweaks; saving does not approve the
design.

### Choosing one

When every concept is ready, the coordinator says what sets each apart and
which it recommends. Below that, the conversation asks you to confirm:

- With one concept, choose **Confirm**.
- With several, each concept's name opens its mockup; choose **Confirm** beside
  the one you want.

The choice shows as "✓ Using …". That design is filed and approved, and the
build plan is written from it next. If you want two concepts blended, or none
fits, say so in the conversation instead.

## 7. Build

Once the build plan is ready and approved, the coordinator says the app looks
ready to build and that you can ask anything first. It then starts the app builder.

### The live preview

A **Live Preview** tab appears next to **Build Plan**. It shows:

- "The app builder is setting up your app…" with the time elapsed, until its first
  changes run.
- **Installing the app's packages**, then **Starting the app**.
- The running app itself, which you can click through as it is built.

The bar above the app offers **Open in a new tab**, and the demo login when the
app has one. **Show the acceptance checklist** lists what the app must do and
how much is "Checked" so far. Use **Hide the controls** to give the app more
room.

### While it builds

The conversation shows who is working and what they are doing. You do not need
to do anything except answer what is asked of you:

- **Packages**: a card may ask "Install … into your app?" Choose **Yes, go
  ahead**, **Always allow** (for the rest of this build) or **Decline**. Turn
  on **Install any package without asking** in Settings to skip these cards.
- **Questions**: the app builder never asks you directly. The coordinator passes
  its questions on when they need you.

### Asking for changes

Try the app, then describe any change in the conversation. The coordinator sends
it to the app builder, after a card asks **Send this change to the app builder?** with
the change written out. Choose **Yes, go ahead** or **Not yet**.

## 8. Download your work

- **The app**: in **Live Preview**, choose **Download the app** for a zip of its
  code. It works during the build too and says which version you got. **Share
  the app** sends it through your device's share menu where available.
- **A document**: choose **Download as Markdown** or **Share as Markdown** in
  the document's bar. Right-click a document's tab and choose **Save as PDF or
  print** to print it.
- **The design**: choose **Download the design** on the design.
- **The whole project**: open the project's menu and choose **Export**. Tick
  **Planning documents**, **Design documents and mockups** and **Build**, then
  **Export**. You get a zip that always includes a `project.json` file.

To bring a project back, choose **Import project** on the new-project page and
pick the `project.json` file from an export. If the file marks documents as
approved, you choose **Import and approve** (records your own approval of
exactly those versions) or **Import without approvals**.

## 9. Manage projects

### The projects list

The sidebar has **New project**, **Projects** and **Projects in progress**,
which lists your open projects that are not archived or shipped.

**Projects** shows every project in the workspace. Filter by **All**, **Idea**,
**Building**, **Shipped** or **Archived**. A project is an **Idea** until the
builder has started, **Building** after that, and **Shipped** once you mark it
so.

Each project has a menu (the "…" beside it, or its title at the top):

- **Project info…** and **Rename**
- **Export**
- **Mark as shipped**, or **Reopen** for a shipped project
- **Archive**, or **Unarchive**
- **Delete…**, then **Yes, delete it** to confirm. This cannot be undone.

### Archived projects

An archived project says "This project is archived." Its documents, design and
app stay open to read and download, but its conversation is closed. Choose
**Restore** to work on it again.

### Reopening a project

Open any project from the sidebar or the list. If its coordinator is not
running, Builder starts it again and the conversation continues where it left
off.

### When a model provider is unavailable

If the project has no model to run on, a notice replaces the message box with
the reason, such as "No model provider is configured." Choose **Open Settings**,
fix it under **Providers** or **Profiles**, then choose **Retry**.

If a provider stops answering or refuses its key during work, the coordinator
stops and you see "The coordinator stopped before it replied." Check the
provider's status in **Settings → Providers**, then send your message again.

## 10. Troubleshooting

- **"Builder is loading…" for a long time**: Builder cannot reach its server
  yet. It keeps retrying. Check that the server is running.
- **"The hub is not answering"**: the server stopped responding. Wait, or ask
  whoever runs it to restart it.
- **"Builder is responding slowly"**: everything waits on the server. If it
  stays slow, restart it.
- **"At least ten characters to start a project."**: describe the idea in a
  little more detail.
- **"No model provider connected"**: choose **Connect a model provider**.
- **"The provider refused this key."**: check the key and test again.
- **"The provider did not answer with a model list."**: check the **Base URL**
  and test again.
- **"The sign-in timed out."**: choose **Log in** again and finish within five
  minutes.
- **"The coordinator for this project did not start."**: choose **Retry**.
- **"The coordinator stopped before it replied."**: check your provider in
  Settings, then send your message again.
- **"Your answers were not sent."**: your choices are kept. Choose **Send
  answers** again.
- **"Your choice was not sent. Try again."**: choose **Choose this one** again.
- **"The design could not be chosen."**: choose **Confirm** again.
- **"Not started — the go-ahead ran out of time"** (or **expired**): ask the
  coordinator to try again.
- **"Did not finish: …"** on a hand-off: ask the coordinator to try again.
- **A quiet "Status update" line saying a specialist ended**: it gives the
  reason, such as "it ran out of time". The coordinator can start it again; ask the
  coordinator to carry on.
- **"The app could not start."**: open **The app's last output** to see why,
  and ask the coordinator to fix the app. It starts again when the app's files
  next change.
- **"The app is stopped."**: nothing is running it right now. Ask the
  coordinator to fix the app.
- **"No app preview here"**: this server cannot run apps, so the app cannot be
  shown.
- **"This project is archived. Restore it to make changes."**: choose
  **Restore**.
- **"The coordinator cannot read that kind of file."**: attach a different kind
  of file.
