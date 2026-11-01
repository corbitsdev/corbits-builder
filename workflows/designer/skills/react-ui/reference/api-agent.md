<!-- Generated from @corbits/react-ui 0.5.0. Regenerate: bun scripts/react-ui-api.ts -->

# react-ui: conversation, agent runs, media and artifacts (0.5.0)

Props per exported component, from the installed declarations. `?` marks optional. `+native` means the component also accepts the native props of the element it renders (`className`, `onClick`, ...). Import from the package root unless SKILL.md lists the module as a subpath.

## ui/action-bar

### ActionBar — One bar of quiet controls for a view: groups of icon or text buttons with a rule between them, toggles, menus, status notes and a sideways-scrolling strip.
label: string
groups: readonly ActionBarGroup[]
placement?: "inline" | "floating"
collapsed?: boolean
defaultCollapsed?: boolean
onCollapsedChange?: ((collapsed: boolean) => void)
popover?: ReactNode
rootRef?: Ref<HTMLDivElement>
barRef?: Ref<HTMLElement>
collapseLabel?: string
expandLabel?: string
className?: string

## ui/activity

### Activity +native — A stretch of an agent's work, thinking and tool calls however many, as one block.
steps: readonly ActivityStep[]
streaming?: boolean
open?: boolean
defaultOpen?: boolean
onOpenChange?: ((open: boolean) => void)

### ActivityTrigger — The run's one line, which opens and closes it.
label?: ReactNode
labels?: Partial<ActivityTriggerLabels>
className?: string

### ActivityContent — The run's steps, while open: the latest ten, with a control for the rest.
renderStep?: ((step: ActivityStep, index: number) => ReactNode)
labels?: Partial<ActivityContentLabels>
className?: string

## ui/artifact-body

### ArtifactBody — One artifact, drawn the way its kind implies.
artifact: Artifact
form?: ArtifactForm
className?: string

## ui/artifact-notice

### ArtifactNotice — The one place an artifact viewer says "there is nothing to draw here".
pending?: boolean
message?: string

## ui/attachment-drop-zone

### AttachmentDropZone +native — An area that takes dropped files and whole folders, usually the chat around its input.
maxFolderEntries?: number
onFiles: (files: readonly File[], details: FileDropDetails) => void
disabled?: boolean
onError?: ((error: unknown) => void)
label?: ReactNode

## ui/attachments

### AttachmentInfo +native — The file's name and size.

### AttachmentRemove +native — Removes the file: `onClick` asks the host to take it out of its list.
label?: string

### AttachmentMore +native — The attachments folded away, as "+N": clicking it expands `Attachments`.
count: number

### Attachments +native — Files shown three ways: a `stack` above the message box, `tiles` in a message, or a `list`.
children?: ReactNode | ((state: AttachmentsState) => ReactNode)
variant?: AttachmentsVariant
expanded?: boolean
defaultExpanded?: boolean
onExpandedChange?: ((expanded: boolean) => void)
total?: number
returnFocusTo?: RefObject<HTMLElement | null>

### Attachment +native — One file in `Attachments`; its parts read the file from here.
data: AttachmentData

### AttachmentPreview +native — The file at a glance: the picture, a video's first frame, or for anything else its type.
label?: string
onOpen?: ((data: AttachmentData) => void)

## ui/compare-body

### CompareBody — Two or more variants of the same thing, side by side, with the verdict said out loud.
comparison: Comparison
className?: string

### CompareBodyFromJson — The JSON-string entry point, for when the payload arrives as artifact content.
content: string
pending?: boolean

## ui/conversation-divider

### ConversationDivider +native — A rule across the conversation with an optional label in the middle: a day ("Today", "March 3") or any other break.

### ConversationNotice +native — A one-line system event in the conversation: someone joined, a run was scheduled, a setting changed.
icon?: ReactNode

## ui/conversation-earlier

### ConversationEarlier +native — Sits first in `ConversationContent` while older items exist, and asks for them (`onReachStart`) as it nears the view, so history loads as the reader scrolls up.
hasEarlier: boolean
loading?: boolean
stalled?: boolean
onReachStart: () => void
distance?: number

## ui/conversation-map

### ConversationMap +native — A rail of ticks, one per turn, for finding your way around a long conversation.
onSelect?: ((id: string) => void)
turns: readonly ConversationMapTurn[]

## ui/conversation-thread

### ConversationThread +native — A reply conversation, a thread: the parent message, a rule counting the replies, the replies, and the thread's own input under them.
parent: ConversationMessage
replies: readonly ConversationMessage[]
renderMessage: (message: ConversationMessage) => ReactNode
sentId?: string
scrollPolicy?: ConversationScrollPolicy
labels?: Partial<ConversationThreadLabels>
children?: ReactNode

## ui/conversation

### Conversation +native — Owns a conversation's scrolling and shares it through `useConversation()`.
scrollPolicy?: ConversationScrollPolicy
sentId?: string

### ConversationEmptyState +native — No items yet.
description?: ReactNode
icon?: ReactNode

### ConversationContent +native — The scrolling log, and the part's root: `ref`, `id`, `className`, the ARIA naming props and every other prop go to the scroll container (role `log`).

### ConversationItem +native — One entry in the conversation, registered by `itemId` so the conversation can find it, settle it and anchor on it.
itemId: string

### ConversationScrollButton +native — Appears when the end of the conversation is out of view and glides back to it.

## ui/dictation-status-line

### DictationStatusLine — The line under a composer that a microphone toggle turns on: "Listening:" with a waveform, a starting message, or a refusal — never more than one of these, and absent entirely once `state` is `"idle"` or `"unsupported"`, so the row does not otherwise change the composer's shape.
state: DictationState
levels?: readonly number[]
startingLabel?: string
listeningLabel?: string
errorMessage?: string
className?: string

## ui/dither-canvas

### DitherCanvas — A dithered field that reacts to the pointer — decoration for a full-bleed panel, and nothing else.
cell?: number
color?: string
warpRadius?: number
className?: string

## ui/dither-field

### DitherField — Something being made, as a live dither: a slow interference field in the foreground colour and a band of the primary sweeping across, over the muted ground.
seed: number
reveal?: DitherFieldReveal
className?: string

## ui/embed-body

### EmbedBody — A third-party URL, framed.
url: string
title: string
description?: string
downloadUrl?: string
aspect?: "wide" | "tall"
className?: string

## ui/generated-images

### GeneratedImages +native — Images an agent made, from one image part.
part: PartImage
onOpen?: ((index: number, opener: HTMLElement) => void)
onRetry?: (() => void)
onDownload?: ((index: number) => void)
onCopy?: ((index: number) => void)
renderImage?: ((image: ConversationImage, index: number) => ReactNode)

### GeneratedImagePlaceholder +native — Where an image will land while it is made: the exact space it takes, filled with the forming grain, and the size it will be.
width: number
height: number
index?: number

### GeneratedImage +native — One finished image, inside `GeneratedImages`.
image: ConversationImage
index: number

### GeneratedImageActions +native — Download, Copy and Open over a `GeneratedImage`'s corner, one for each of `GeneratedImages`' `onDownload`, `onCopy` and `onOpen` that is given.

## ui/media-viewer

### MediaViewer +native — Pictures, video, audio, PDFs and text full size, over everything, on the native modal `<dialog>`: it holds focus and closes on Escape, and a click outside the media closes it too.
viewer: MediaViewerState<MediaViewerItem>

## ui/message-actions

### MessageActions +native — The row of actions under a message: `MessageAction` buttons, then a `MessageActionMenu` for the extras.

### MessageAction +native — One action: an icon button in `MessageActions`, or an item (icon and label) inside a `MessageActionMenu`.
label: string
children?: ReactNode

### MessageActionMenu +native — The overflow menu at the end of `MessageActions`.
label?: string
children: ReactNode
icon?: ReactNode
open?: boolean
side?: "top" | "bottom"
align?: "start" | "end"
onOpenChange?: ((open: boolean) => void)

## ui/message-fold

### MessageFold +native — Folds a very long answer to its opening, with a control to show the rest.
length: number
threshold?: number
streaming?: boolean
open?: boolean
defaultOpen?: boolean
onOpenChange?: ((open: boolean) => void)

### MESSAGE_FOLD_THRESHOLD — Answers longer than this many characters (about a thousand words) fold.

## ui/message-parts

### MessageParts +native — A message's parts, each as its component: runs of thinking and tool work fold into one `Activity` each (`groupActivity`), a call waiting on a person stands out as a `ToolApproval` (or inside its `ToolGroup`), text is a `MessageContent`, files are `Attachments` tiles, images `GeneratedImages`, sources `Sources` and events a `ConversationNotice`.
parts: readonly ConversationPart[]
streaming?: boolean
onDecide?: MessagePartsDecide
onOpenImage?: ((part: PartImage, index: number, opener: HTMLElement) => void)
renderMarkdown?: ((text: string) => ReactNode)
renderStep?: ((step: ActivityStep, index: number) => ReactNode)
renderText?: ((part: PartText) => ReactNode)
renderActivity?: ((steps: readonly ActivityStep[], state: { readonly streaming: boolean; }) => ReactNode)
renderApproval?: ((part: PartTool, decide: (decision: ToolApprovalDecision) => void) => ReactNode)
renderBatch?: ((part: PartToolBatch, decide: MessagePartsDecide) => ReactNode)
renderBlock?: ((part: PartBlock) => ReactNode)
renderFiles?: ((files: readonly PartFile[]) => ReactNode)
renderEvent?: ((part: PartEvent) => ReactNode)
renderImages?: ((part: PartImage) => ReactNode)
renderSources?: ((part: PartSources) => ReactNode)

## ui/message-reactions

### MessageReactions +native — The reactions on a message, one chip per emoji with its count.
reactions: readonly ConversationReaction[]
onReact?: ((emoji: string) => void)

## ui/message-replies

### MessageReplies +native — The replies to a message: how many and when the last one came, as a button that opens the thread (the host's `onClick`).
replies: ConversationRepliesSummary
now?: number

## ui/message

### Message +native — One message, built from parts: `MessageAvatar`, `MessageHeader`, `MessageContent`, `MessageSendStatus`, `MessageFooter`, and anything else the host puts in.
from: MessageFrom
status?: ConversationMessageStatus
error?: string
onRetry?: (() => void)

### MessageSendStatus +native — Where a send stands: "Sending…" while `sending`; the error and a Retry control (when the message has `onRetry`) once `failed`.

### MessageAvatar — The author's avatar, in a column of its own beside the message.
className?: string
tone?: AvatarTone
size?: AvatarSize
status?: AvatarStatus
shape?: AvatarShape
orbit?: boolean
tenantMonogram?: string
name: string
initials?: string

### MessageHeader +native — The author's name, an optional role and when the message was sent.
name: ReactNode
role?: ReactNode
at?: string
now?: number
formatTime?: ((at: string) => string)

### MessageContent +native — The message body: `text` (through `render` when given) or, without `text`, the children.
text?: string
render?: ((text: string) => ReactNode)

### MessageFooter +native — One line under the message: reactions, replies, actions.

## ui/mic-button

### MicButton — A microphone toggle for dictation, presentational only.
state: DictationState
onToggle: () => void
disabled?: boolean
className?: string

## ui/mic-permission-dialog

### MicPermissionDialog — A refusal that is a setting, put in front of the person with the button that opens the pane.
open: boolean
onOpenChange: (open: boolean) => void
title: string
detail: string
actionLabel: string
onAction: () => void
failure?: string | null
dismissLabel?: string

## ui/prompt-input-toolbar

### PromptInputToolbar +native — The row of controls under the text.

### PromptInputButton +native — An icon button sized for the toolbar: voice, attach, anything the host adds.
aria-label: string

### PromptInputFloat +native — What floats above the box: the reply context, attachments, a notice.

### PromptInputContext +native — A chip saying what the next message is about: the message it replies to, the item it refers to.
label: string
detail?: string
icon?: ReactNode
onClear?: (() => void)
clearLabel?: string

### PromptInputNote +native — Small print under the box, such as a reminder that answers can be wrong.

### PromptInputAddMenu +native — The `+` button and its menu of ways to add to the message: files, a mention, a command.
label?: string
disabled?: boolean
open?: boolean
align?: PromptInputPopupAlign
onOpenChange?: ((open: boolean) => void)
defaultOpen?: boolean
items: readonly PromptInputAddMenuItem[]

### PromptInputModelSelect +native — Which model answers.
label?: string
disabled?: boolean
defaultValue?: string
value?: string
open?: boolean
align?: PromptInputPopupAlign
onOpenChange?: ((open: boolean) => void)
onValueChange?: ((id: string) => void)
defaultOpen?: boolean
models: readonly PromptInputModelOption[]

### PromptInputModeSelect +native — How the agent works this turn.
label?: string
disabled?: boolean
defaultValue?: string
value?: string
open?: boolean
align?: PromptInputPopupAlign
onOpenChange?: ((open: boolean) => void)
onValueChange?: ((id: string) => void)
defaultOpen?: boolean
modes: readonly PromptInputModeOption[]

## ui/prompt-input

### PromptInput +native — The message box.
value: string
onValueChange: (value: string) => void
onSubmit: () => void
canSubmit?: boolean
tokens?: readonly PromptToken[]
status?: PromptInputStatus
disabled?: boolean

### PromptInputSuggestions +native — The list of tokens the `@` or `/` being typed could become.
children?: ((token: PromptToken) => ReactNode)
announce?: ((count: number) => string)

### PromptInputSuggestion +native — One option in `PromptInputSuggestions`.
token: PromptToken

### PromptInputSubmit +native — Send, or Stop while a reply is in flight (`PromptInput`'s `status` is not `ready`) and `onStop` is given.
onStop?: (() => void)

### PromptInputTextarea +native — The text.

## ui/provider-mark

### ProviderMark — Which service an action goes through.
provider: string
logo?: ReactNode
size?: "sm" | "md"
className?: string

## ui/reasoning

### Reasoning +native — An agent's thinking, folded to one line: how long it thought and the start of what it thought.
part: PartReasoning
streaming?: boolean
open?: boolean
defaultOpen?: boolean
onOpenChange?: ((open: boolean) => void)

### ReasoningTrigger — The thinking's one line, which opens and closes it.
label?: ReactNode
streamingLabel?: ReactNode
className?: string

### ReasoningContent — The whole thinking, while open.
render?: ((text: string) => ReactNode)
className?: string

## ui/research-body

### ResearchBody — A structured research brief: what was found, grouped, quoted and cited.
brief: ResearchBrief
body?: string
className?: string

## ui/sort-header-button

### SortHeaderButton +native — The control inside a sortable column header.
direction: SortDirection | null

## ui/sources

### Sources +native — Where an answer's facts came from: a numbered list of `Source` citations that wraps across lines.

### Source +native — One citation, opening in a new tab.
href: string
children: ReactNode
index?: number

## ui/thinking-indicator

### ThinkingIndicator — A thinking status with Silk, Strata, or Echo motion.
label?: string
variant?: ThinkingVariant
paused?: boolean
className?: string
style?: CSSProperties

## ui/thinking-label

### ThinkingLabel — The shimmering "working" word, rotating through caller-supplied verbs on an interval.
verbs: readonly string[]
intervalMs?: number
statusLabel?: string
className?: string

## ui/thinking-mark

### ThinkingMark — Decorative animated Corbits mark.
variant?: ThinkingVariant
paused?: boolean
className?: string
style?: CSSProperties

## ui/tool-approval

### ToolApproval +native — A tool call's approval.
disabled?: boolean
part: PartTool
children?: ReactNode
onDecide: (decision: ToolApprovalDecision) => void
renderInput?: ((input: unknown) => ReactNode)
error?: ReactNode
labels?: Partial<ToolApprovalLabels>

## ui/tool-group

### ToolGroup +native — Tool calls that ran at the same time: one row saying so, the calls beneath.
part: PartToolBatch
open?: boolean
onOpenChange?: ((open: boolean) => void)
defaultOpen?: boolean
onDecide?: ((tool: PartTool, decision: ToolApprovalDecision) => void)
labels?: Partial<ToolGroupLabels>
renderTool?: ((tool: PartTool) => ReactNode)

## ui/tool-picker

### ToolPicker — Browse, search and select tools from a caller-supplied catalog, grouped by package.
items: readonly ToolPickerItem[]
value: readonly string[]
onChange: (value: readonly string[]) => void
multiple?: boolean
loading?: boolean
empty?: ReactNode
searchPlaceholder?: string
searchLabel?: string
className?: string

## ui/tool

### Tool +native — One tool call: a header row that opens onto its input and output.
part: PartTool
open?: boolean
defaultOpen?: boolean
onOpenChange?: ((open: boolean) => void)

### ToolHeader — The call's row: its status as an icon and a word, the label and the raw tool name.
label?: ReactNode
statusLabels?: Partial<Record<ToolTraceStatus, string>>
className?: string

### ToolInput — The call's arguments, while the call is open.
render?: ((value: unknown) => ReactNode)
title?: string
className?: string

### ToolOutput — What the call returned, or why it failed, while the call is open.
render?: ((value: unknown) => ReactNode)
title?: string
className?: string
errorTitle?: string

## ui/typing-indicator

### TypingIndicator — Three pulsing dots: the agent is composing a reply, with nothing to report yet.
label?: string
className?: string

## ui/voice-waveform

### VoiceWaveform — A bar waveform driven entirely by `levels` — no microphone or audio API here, the consumer's dictation hook owns sampling and passes the numbers in.
levels: readonly number[]
className?: string
