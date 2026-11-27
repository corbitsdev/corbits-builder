# Builder user manual

Builder lets you build, write, edit or improve almost anything: an app, a
command-line tool, a library, a document, research, an analysis, or a small
change to something that already exists. You talk to one assistant, the
coordinator. It talks the work through with you, then brings in specialists
such as a writer, a designer, a coder, a presenter and others that are
installed, and ready-made plans, as the work needs them. There is no fixed
path: what happens depends on what you ask for. You approve what needs your
approval before the work goes on.

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
tiers (Low, Medium, High and Max), and each kind of work runs on one tier: the
Coordinator, the Writer, the Reviewer, the Designer, the App builder and the
Presenter.

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

**Settings → Preferences** says "New projects start with these. What you say in
a project wins." Each change saves on its own. The settings, with their
defaults first:

Under **Conversation**:

- **Questions**: Only essentials, Every decision, or Decide for me.
- **Replies**: Concise or Detailed.
- **Language**: Plain, or Technical to name code, files and jargon.
- **Next step line**: Hidden, or Shown for a line above the conversation
  saying who is working and what you do next.

Under **Reviews and approvals**:

- **Documents**: You approve each, or Builder goes ahead, which lets each
  document go ahead once it is written.
- **Open questions**: Answered first, so a document reaches you for approval
  only once its open questions are answered, or Can stay open.
- **Reviews raise**: Real problems, or Problems and polish.
- **Design concepts**: 3, or 1 to 5: how many looks the designers make when
  you explore.

Under **Building the app**:

- **New packages**: Install freely, so the coder adds the packages it needs, or
  Ask me first, so you approve each new package it wants to add.
- **Internet**: Any website, or npm registry only, so the coder can still
  install packages but reach nothing else.

Under **Stakeholder approvals**, marked Experimental: **Approval packages**, Not
used or Share with reviewers.

A project keeps the preferences its creator had when it started; a later
change applies to new projects.

The same tab also has **Appearance** (a Light, System or Dark theme, and
whether **Document tips** are shown) and your **Account**, with **Sign out**.

## 2. Start a project

From **New project** in the sidebar you see "What do you want to make today?"

1. Type what you want in the box that says "Describe what you want to make or
   change…". It can be anything: a new thing, a change to something that
   exists, or a piece of writing or research. You can also dictate with the
   microphone.
2. The **Model profile** picker in the box shows the profile the project will
   use. Change it here if you want a different one.
3. Send it. You see "Starting your project…" and then the project opens.

The project opens on the conversation. **Project** opens everything the
project has, its documents, design and preview, over the conversation, and
**Back to the conversation** returns.

The coordinator replies first. It welcomes what you asked for, asks what it
needs to know and lays out a plan, which may bring in a writer, a designer, a
coder or other specialists. How many questions it asks depends on your
**Questions** setting.

You can ask for anything, and the work fits what you ask. An idea for an app
gets requirements, a design and a build plan before it is built. A small
change, such as "make the buttons green", goes straight to the work without
reopening any document. A question about your project, or research, comes back
as an answer or a document.

You can reply in your own words at any time. When a reply ends with a short list
of options, they also appear as buttons above the message box; choose one to
send it.

To share files, use **Attach files** (the paperclip) in the message box. Each
file is filed with the project for the coordinator to read.

## 3. Answer questions

When the coordinator needs decisions from you, it shows a card with up to five
questions, titled for how many it asks: **A question for you**, **A couple of
questions for you** or **A few questions for you**.

The card shows one question at a time, with your earlier answers above it and
the next question below.

- **Pick one**: click an option, and the card moves to the next question. On
  the last question it waits for **Send answers**.
- **Pick any that apply**: tick every option that applies, then **Continue**.
- **Something else…**: when offered, type your own answer in that row.
- A question with no options to pick from has a field for your answer.

The coordinator's recommended answers are already selected. Change any you
disagree with. **Continue** turns on once the question has an answer; on the
last question it becomes **Send answers**. **Back**, or clicking an earlier
answer, takes you back to change it.

From the keyboard, once you click or Tab into the card: ↑ and ↓ move between
options, Space picks the one you are on, and Enter continues. On a pick-one
question, Enter continues with the option you moved to, and a number key picks
the option in that place and moves on, except on the last question. → goes to
the next question and ← goes back.

The card stays open until you answer, even if you reload the page. After you
send, the card shows "Your answers" with each question and your answer. If you
reply in the conversation instead, the card says "Answered in your own words"
and shows what you wrote. If the coordinator stops before you answer, the card
says "This question is no longer open" and lists its questions as not answered.
The card stays in the conversation when a new coordinator takes over, and the
new coordinator is told the question was left unanswered.

### Screens

Some decisions come as a screen made for them instead of a list of options:
approving documents, reviewing or choosing a design, how many looks to compare,
picking fonts or colours, or whether Builder should stop to ask you. A screen
sits in the conversation, or opens over the whole page with the message box
still at the bottom. Whatever a screen shows, you can type what you want in the
message box instead, and that is your answer. **Cancel** closes it without
choosing.

If an answer cannot be saved, you see "Your answer was not accepted. Your
choice is kept." and can try again.

## 4. The plan, documents and approvals

### The plan

**Show the plan** opens the plan beside the conversation: the steps the
coordinator intends, each marked with where it stands, such as done, running,
waiting or needing you. A step that waits for your approval says **needs your
approval** or **asks for your approval**, and one you may leave out says
**optional**. The button shows how far along the plan is, and says when a step
failed or needs you.

On a step that has not started you can turn on **Ask me first**, so it waits
for you; it then shows **Go ahead**, which lets it start. On an optional step,
**Skip** leaves it out, and turning **Skip** off brings it back. The
coordinator is told each time.

### What gets written

There is no fixed set of documents and no fixed order. The coordinator and its
specialists write what the work needs, and a document may build on others. The
kinds you may see include:

- **Requirements**: what it does, and for whom.
- **Build plan**: how it is built, in what order, and the acceptance
  checklist.
- **Brief**, **Constraints** and **Approaches**, when the work calls for them.
- **User manual**, research, an analysis, an approval package, or anything
  else you ask for.

A reviewer may also check a document and advise the coordinator. That review
is advice, never an approval.

### Reading a document

Open **Project** and choose a document's tab, or choose the document where it
appears in the conversation. A dot on a tab means a new
version you have not opened yet. Hover over a tab to see whether it is
**Drafted** or **Approved**, and at which version.

While reading, you can:

- Select a passage on a written document's page to comment on it. The comment
  waits beside the passage as a draft you can edit or delete. When you are
  ready, press the comments count in the message box (or **Send** with the box
  empty) to send every comment as one message, each under its quote. Comments
  wait while a question or an approval is open, and stay in the tab if you
  reload it.
- Use the version menu to open an earlier version, or **Compare with previous**
  to see what changed. **Stop comparing** returns to the normal view.
- Use **Tips** in the bar at the foot of the document for reminders. You can
  turn them off there or in Settings.

To ask for a change, write it in plain words in the conversation.

If you ask to change a document that a specialist is already working from, you
see a warning that it may cost more and restart some of their work. Choose
**Send anyway** or **Cancel**.

### Approving a document

When documents are ready for you, the **Approve the documents** screen appears
in the conversation, asking "Approve the product requirements?" or "Approve these 2
documents?". It shows each document with its version and summary; choose a
document's title to read it in full.

- **Approve** approves exactly the versions shown. The card becomes "Approved,
  version …" and the work goes on.
- To ask for changes, type what should change in the message box and send it.
  That is your answer, and the coordinator has the document revised.

You can also approve a document you are reading without being asked. If the
coordinator was waiting for that approval, the screen closes with it.

### What approval means

An approval covers one exact version of a document. If the document changes
afterwards, the coordinator decides whether to put it to you again. Work that
builds on a document uses the version you approved.

By default a document reaches you for approval only once its open questions are
answered (**Open questions**). If you set **Documents** to **Builder goes
ahead**, documents go ahead once written and the coordinator tells you about
each one instead.

### Letting Builder go ahead without asking

Tell the coordinator to just build it, or to stop asking, and it shows **Ask
before each step?** Choose **Go ahead without asking** to hand your approvals
to Builder for this project: each step then starts as soon as the one before it
is filed, and the coordinator tells you what was filed instead of asking.
**Keep asking me** leaves things as they are. Ask again later and the same
screen offers **Ask me again**. A step the plan marks as needing your approval
still waits for you.

## 5. Approaches

When the coordinator has had ways of doing the work compared, the
**Approaches** document opens with **Approaches side by side**: one card per
approach, with its name, a summary, the effort (**Low effort**, **Medium
effort** or **High effort**), **Best for**, **Pros**, **Cons** and **Risks**.
One card is marked **Recommended**.

**Pick this one** on the approach you want sends the coordinator "I choose the …
approach." Your pick is marked **Your choice**.

## 6. Design

When the work has something to look at, the coordinator checks in. It may ask
**How many looks do you want to compare?**, with **One**, **Two** and
**Three** to choose from and a button to go on, such as **Compare three looks**,
and whether you have a look in mind:
examples you like, colours or a feel. If you did not say how many, you get as
many as your **Design concepts** setting says. Each look starts from one of
Builder's five themes, or from a theme made for your brand or your own
description.

### Following a design

Each concept gets a tab in the project view, such as **Design mockup 1 ·
Workbench**, which shows the draft as its designer works.
In a mockup you can switch **Screen**, try its states, **Switch light and
dark**, view it as **Desktop** or **Phone**, and **Expand to full screen**.
**Tweak the look** opens **Primary colour**, **Background**, **Corner radius**
and **Font**. **Save these** keeps your tweaks; saving does not approve the
design.

### Reviewing a design

With one design ready, **Review the mockup** opens it over the whole page. Try
it, and to comment on a place, turn on **Tag** and click there to pin a comment.
**Approve** approves the design and files it as the project's design. With
comments pinned, or a note typed in the message box, Send sends them back to
the designer instead, and approving then asks you to confirm that the comments
will be discarded.

### Choosing between designs

With several designs ready, **Choose a design** opens them side by side over the
whole page. **Choose this design** picks one, and you may **Comment** on any of
them as you go. The one you choose is filed as the project's design. If you
want two blended, or none fits, type that instead.

### Fonts and colours

Ask to change the fonts or the colours and the coordinator opens a picker.
**Choose your fonts** searches the font list for a **Primary** font, for
headings and body text, and a **Secondary** font, for code and figures; some
fonts are marked **Paid**. **Choose your colours** sets the **Primary** colour
of buttons and links and the **Background**. When the coordinator proposes a
change you can use it or choose your own. **Change my fonts** or **Change my
colours** saves your choice as the project's, in its design once it has one;
**Keep my fonts** or **Keep my colours** leaves them as they were.

## 7. Build

When there is something to build, the coordinator hands it to the coder. The
coder builds whatever the project is: a web app, a command-line tool, a
library or something else. You can ask anything first.

### The live preview

When the coder has something that opens in a browser, a **Live Preview**
appears among the project's views. A command-line tool, a library or anything
else that does not open in a browser has no preview; its code is still checked
and can be downloaded. The preview shows:

- "The coder is setting this up…" with the time elapsed, until its first
  changes run.
- **Installing the packages it needs**, then **Starting it**.
- The running result itself, which you can click through as it is built.

The bar above it offers **Open in a new tab**, and the demo login when it has
one. **Show the acceptance checklist** lists what it must do and how much is
"Checked" so far. Use **Hide the controls** to give the preview more room.

### While it builds

The conversation shows who is working and what they are doing. You do not need
to do anything except answer what is asked of you:

- **Packages**: with **New packages** set to **Ask me first** in Settings, a
  card asks "Install … into your project?" for packages that no approved build
  plan names. Choose **Yes, go ahead**, **Always allow**
  (for the rest of this build or change; the next change asks again) or
  **Decline**. While the card is open, typing a plain "yes", "ok" or "go ahead"
  approves it after a short countdown ("Approving in 5s"); **Undo** sends your
  words as an ordinary message instead.
- **Questions**: the coder never asks you directly. The coordinator passes its
  questions on when they need you.

A working specialist's row has **Stop**, which asks once before it stops the
run; what it saved before stopping is kept.

### Asking for changes

Try it, then describe any change in the conversation. The coordinator sends it
to the coder. Each change is made by a fresh coder starting from the saved
code, once the one before it has finished.

## 8. Publish your app

Once the project has a saved app, **Publish** appears beside the plan. It opens
the **Publish** tab, which shows where your app is published and lets you
publish it. Press **Publish**; Builder asks you only what it needs, in the
conversation:

- **Where**: when more than one place is installed, choose one and **Continue**.
  **Your own server** puts the app on a Debian or Ubuntu server you already
  rent, billed by your hosting provider. **DigitalOcean** has Builder set up a
  server for you in your own DigitalOcean account, from $6 a month, billed by
  DigitalOcean. Both are reached at the server's IP address, which is not a
  secure (https) address yet, so do not use the app for passwords or payments
  there. **Cloudflare** puts it at a secure address of its own, free to start
  and with no account needed.
- **Your server**: **Connect your server** shows a key to paste where your
  hosting provider asks for an SSH key when you create the server, and asks for
  the server's IP address. **Connect** checks that the server lets Builder in
  with the key; if it does not yet, add the key at your hosting provider and
  try again. The key stays the same until the server is connected or you
  choose **Make a new key**.
- **Publish to DigitalOcean**: choose the server's size, each shown with what it
  costs a month (the smallest, 1 GB, is enough for most apps), and the place it
  runs, nearest the people who'll use your app. **Sign in** then opens
  DigitalOcean in a new tab: sign in there, pick the team that pays, and come
  back. DigitalOcean bills that team for the server every month, on your
  DigitalOcean bill, until you take the app down. If DigitalOcean's price
  changed since, or you signed in with another team, Builder makes nothing and
  shows this screen again with the real price.
- **Your Cloudflare account**: choose **Publish without an account** and accept
  Cloudflare's terms, or **Use my Cloudflare account** and paste a token from
  your Cloudflare dashboard.
- **The go-ahead**: each time you ask to publish, Builder asks once and waits
  for **Publish**, or **Publish changes** once the app is out. The first time it
  says where the app goes; for changes, only that people will see the version
  you saved last. If a step needs you on the way, such as connecting a server or
  choosing a new one, Builder carries on afterwards without asking again. On
  DigitalOcean the server is made after this, which takes a few minutes.

The tab then shows **Your app is published** with its address and **Open**.
After you save a newer version it shows **You have changes to publish**.

An app published without a Cloudflare account must be kept within about an
hour. **Keep your app** shows the time left: choose **Keep my app**, sign in to
Cloudflare or create a free account, then choose **I kept it**. Share the
address once you have kept the app. If the time passes, say **I kept it** or
**I didn't keep it**; Cloudflare removes an app that was not kept. To publish
changes to a kept app, add a token for that account on the Publish to
Cloudflare screen.

### Taking your app down

Under the published app, the **Publish** tab offers **Take it down**, or you
can ask in your own words. Nothing is taken down yet: Builder first shows
**Take your app down?**, with what goes, the address people open now, and
whether what people entered in the app is kept or deleted. Choose **Take it
down** to go ahead, or **Keep it**. While it works the tab says **Taking it
down…**; if it cannot finish, it says why and offers **Try again**. If you
already removed the app yourself, such as by cancelling the server, open the
menu beside it, choose **I already removed it myself…**, then **Yes, it's
gone**, and Builder stops showing the app as published. Once the app is down,
the tab looks as it did before your first publish.

It goes differently at each place:

- **Your own server**: what people entered is kept, so publishing again brings
  it back. The server stays yours, and keeps costing what your hosting provider
  charges, until you cancel it there.
- **Cloudflare**: what people entered is kept, so publishing again brings it
  back. Without a saved token, **Take your app down from Cloudflare** asks for
  one for the account the app is in. An app published without a Cloudflare
  account and never kept needs nothing: Cloudflare removes it once the time to
  keep it passes, and the screen says when, or that it already has.
- **DigitalOcean**: taking the app down deletes the server Builder made, with
  everything on it, including what people entered, and DigitalOcean stops
  charging for it. Publishing again has you choose a server again and starts
  on a new, empty one. If your DigitalOcean sign-in has lapsed, Builder asks
  you to sign in again first; if it still cannot delete the server, it tells
  you the server's name so you can delete it in your DigitalOcean account
  yourself. If you deleted the server at DigitalOcean yourself, Builder
  forgets it the next time it looks, and publishing again has you choose a new
  one.

When Builder set up something for your app that costs money, such as a server
it rented for you, the tab shows where it is hosted and what it costs, such as
**Hosted on DigitalOcean · $6 a month**, under the address, until it is taken
down. If you removed it yourself, or closed your account there, open the menu
beside that line, choose **I already removed it from DigitalOcean…**, then
**Yes, it's gone from DigitalOcean**, and Builder stops showing it.

## 9. Download your work

- **The code**: in **Live Preview**, choose **Download the code** for a zip of
  it. It works during the build too and says which version you got. **Share the
  code** sends it through your device's share menu where available.
- **A document**: choose **Download as Markdown** or **Share as Markdown** in
  the document's bar. Right-click a document's tab and choose **Save as PDF or
  print** to print it.
- **The design**: choose **Download the design** on the design.
- **The whole project**: open the project's menu and choose **Export**. Tick
  **Documents**, **Designs and mockups** and **Code**, then **Export**. You get a zip that always includes a `project.json` file.

To bring a project back, choose **Import project** on the new-project page and
pick the `project.json` file from an export. If the file marks documents as
approved, you choose **Import and approve** (records your own approval of
exactly those versions) or **Import without approvals**.

To make a project from code you already have, choose **Import a folder** on
the new-project page and pick the folder, usually a git repository. Builder
reads it the way it reads its own exports: the code becomes the project's code, and any
documents or design kept in the folder are filed with it. Dependencies,
build output, environment files and whatever the folder's `.gitignore` files
leave out are never read. A card then shows what was found, what Builder still
has to write with you, and files you may want to leave out: those whose names
suggest a secret, and lockfiles of package managers Builder does not use, start
out left out, and you can keep any of them. Choose **Import**. The coordinator
reads what was imported, asks you what you want to do and what the code cannot
tell it, and has only the documents written that the work you ask for needs.

## 10. Manage projects

### The projects list

The sidebar has **New project**, **Projects** and **Projects in progress**,
which lists your open projects that are not archived or shipped.

**Projects** shows every project in the workspace. Filter by **All**, **Idea**,
**Building**, **Shipped** or **Archived**. A project is an **Idea** until the
coder has started, **Building** after that, and **Shipped** once you mark it
so.

Each project has a menu (the "…" beside it, or its title at the top):

- **Project info…** and **Rename**
- **Export**
- **Mark as shipped**, or **Reopen** for a shipped project
- **Archive**, or **Unarchive**
- **Delete…**, then **Yes, delete it** to confirm. This cannot be undone.

### Archived projects

An archived project says "This project is archived." Everything it
made stays open to read and download, but its conversation is closed. Choose
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

## 11. Troubleshooting

- **"Builder is loading…" for a long time**: Builder cannot reach its server
  yet. It keeps retrying. Check that the server is running.
- **"The hub is not answering"**: the server stopped responding. Wait, or ask
  whoever runs it to restart it.
- **"Builder is responding slowly"**: everything waits on the server. If it
  stays slow, restart it.
- **"Describe what you want to make or change to start a project."**: the box
  is empty; type what you want first.
- **"No model provider connected"**: choose **Connect a model provider**.
- **"The provider refused this key."**: check the key and test again.
- **"The provider did not answer with a model list."**: check the **Base URL**
  and test again.
- **"The sign-in timed out."**: choose **Log in** again and finish within five
  minutes.
- **"The coordinator for this project did not start."**: choose **Retry**.
- **"The coordinator stopped before it replied."**: check your provider in
  Settings, then send your message again.
- **"Your answer could not be sent. Try again."**: your choices are kept;
  send them again.
- **"Your answer was not accepted. Your choice is kept."**: the screen is still
  open; answer it again.
- **"This question cannot be shown here. Answer it in your own words below."**:
  type your answer in the message box.
- **"Your choice was not sent. Try again."**: choose **Pick this one** again.
- **"Did not finish: …"** on a hand-off: ask the coordinator to try again.
- **"Blocked"** at the end of a specialist's row: it hit something it could
  not get past, and says why underneath. Deal with what it names, or ask the
  coordinator to try another way.
- **A quiet line saying a specialist ended**: it gives the
  reason, such as "it ran out of time". The coordinator can start it again; ask the
  coordinator to carry on.
- **"It could not start."**: open **Its last output** to see why, and ask the
  coordinator to fix it. It starts again when its files next change.
- **"It is stopped."**: nothing is running it right now. Ask the coordinator to
  fix it.
- **"No preview here"**: this server cannot run what the coder makes, so it
  cannot be shown.
- **"This project is archived. Restore it to make changes."**: choose
  **Restore**.
- **"The coordinator cannot read that kind of file."**: attach a different kind
  of file.
