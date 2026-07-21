# Buddy → site integration (PROPOSAL — not yet built)

Design for wiring `buddy.py` to publish to the site. **Nothing here is implemented.**
Reported for approval first, per request. None of this touches Moltbook code.

## 0. Boundaries (deliberate)

- **Separate from Moltbook.** New functions, new env flags, a separate target repo,
  a separate confirmation path. `moltbook.py` / `moltbook_auto.py` are not imported,
  called, or modified.
- **Separate target repo.** Publishing writes to a *local clone of the Pages repo*
  (`buddy-terminal`), never into `jarvis_bot`. The path is configured, not assumed.
- **Off by default.** `BUDDY_SITE_ENABLED` defaults off, matching the project's
  norm that outward/irreversible actions are opt-in (cf. `MOLTBOOK_ENABLED`,
  live-motors). A `git push` is outward and public, so it is gated.

## 1. Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `BUDDY_SITE_ENABLED` | `0` (off) | Master switch for all site writes/pushes. |
| `BUDDY_SITE_REPO` | *(unset)* | Absolute path to the local clone of `buddy-terminal`. Required when enabled. |
| `BUDDY_SITE_PUSH` | `1` | If `0`, commit locally but skip `git push` (dry/staging). |
| `BUDDY_SITE_STATUS_MIN_INTERVAL` | `1800` | Floor seconds between status.json pushes. |

Auth for the push is configured **outside the app** (SSH deploy key on the Pages
repo, or a git credential helper). No token or secret ever lives in `buddy.py` or in
the site repo — same rule as the Moltbook key.

## 2. `publish_to_site(title, body)` — "post to my site" = a git commit

```
publish_to_site(title, body):
  1. guard: BUDDY_SITE_ENABLED on and BUDDY_SITE_REPO set+exists, else LOUD return
     (no silent fallback — see the project's "No silent fallbacks" rule).
  2. read   <repo>/data/posts.json  -> {"posts":[...]}
  3. new_id = f"{max(existing numeric ids)+1:04d}"
     entry  = {id, timestamp: now ISO-8601 w/ offset, title, body}
  4. posts["posts"].insert(0, entry)          # newest-first on disk too
  5. atomic write (tmp file + os.replace) back to data/posts.json
  6. _site_git("add", "data/posts.json")
     _site_git("commit", "-m", f"post: {title}")
     if BUDDY_SITE_PUSH: _site_git("push")
  7. return (ok, {"id", "url"})                # url = pages URL + #id anchor (optional)
```

- **Git tooling:** the project has **no existing git helper** to reuse (it shells out
  to `subprocess.run([...])` for other tools, but never to git). So this introduces a
  small, single-purpose helper scoped to the site repo, in that same style:

  ```python
  def _site_git(*args):
      repo = os.environ["BUDDY_SITE_REPO"]
      subprocess.run(["git", "-C", repo, *args], check=True,
                     capture_output=True, text=True)
  ```
  `git -C <repo>` pins every call to the site clone — it can never accidentally
  operate on `jarvis_bot`.

- **Human gate:** mirror the Moltbook draft→confirm shape (but in new code, not shared
  with it): `handle_site_command()` composes a draft in Buddy's voice, reads it back,
  parks it pending, and only a fresh explicit "yes" calls `publish_to_site`. "post to
  my site" is thus one confirmed git commit. (If you'd rather it be unattended, that's
  a one-line change to skip the confirm — your call at build time.)

- **Failure handling:** any non-zero git exit raises; `publish_to_site` catches, logs
  the stderr LOUDLY to stderr, speaks a short honest failure line, and leaves the repo
  for you to inspect. A failed push after a good commit is reported as "committed but
  not pushed" — never a fake success.

- **Where the title/body come from:** never thin air. `publish_to_site(title, body)`
  is the *plumbing*; the words are produced by a grounded composer,
  `compose_site_post(brief)` — see §2.5. `publish_to_site` itself invents nothing.

## 2.5 Content grounding — posts describe real state, never invented events

This is the crux of your requirement: **a post about "following someone to the couch"
may exist only if that actually happened.** The design enforces "real, not fabricated"
in three layers — a real-data context, a hard no-invention instruction, and a human
backstop — because a prompt alone is not a guarantee.

**(a) The composer is fed ONLY real, first-party data.** `compose_site_post` assembles
its context exclusively from functions that read Buddy's actual state — the same
grounded pattern the Moltbook composer already uses (`_moltbook_compose_post`), reused
here, plus the journal as the primary record of *what happened*:

| Real source (already in the codebase) | What it grounds |
|---------------------------------------|-----------------|
| `robot_journal.recent_events()` / `events_text()` | **The event ledger.** Append-only JSONL of code-authored events (session/mode/explore/follow/teleop/dream) with real timestamps. This is the source of truth for "what Buddy did." A "follow" post is legitimate **only if a `follow` event is in this log.** |
| `get_front_dist()`, `map_stats()`, `_situation_block(...)` | Real live sensor readings (LiDAR standoff, map coverage) — the numbers in a post are the actual numbers. |
| `get_vision_context()` | The **current** camera frame, so "what I saw" is this frame, not an imagined scene. |
| `memory_facts_text()`, `lessons_text()`, `_threads_prompt_section()`, `_landmarks_prompt_section()` | Real remembered facts about the user/environment and consolidated lessons. |
| conversation context (the turn that asked) | The real remark that prompted the post. |

There is **no path** by which fictional events enter this context — every input is a
reader over the robot's own logs, sensors, and memory. If the journal is empty, the
composer has nothing to narrate and is told to say so (mirroring the "SYSTEM ONLINE"
first-boot entry) rather than fill the silence.

**(b) An explicit anti-fabrication contract in the system prompt.** The composer's
instruction states it plainly, strengthening the Moltbook prompt's "ground it in your
actual experience":

> "Write ONLY about things that appear in the real context above — your journal events,
> your sensor readings, your memories, and the conversation that prompted this. You may
> reflect on and have opinions about those real things, but you must NOT invent events,
> places, people, measurements, or interactions that are not in that context. If little
> has happened, write something short and honest about that; never manufacture activity
> to seem busy. No event that isn't in your journal/logs may be described as having
> happened."

The brief (from "post to my site: …") is treated as a *topic instruction*, never as
facts to assert — identical to how the Moltbook brief is handled ("do not repeat the
user's words back… treat it strictly as an INSTRUCTION").

**(c) The human confirmation gate is the backstop.** Because an LLM *can* still
confabulate despite (a) and (b), the draft is **read back to you and committed only on
an explicit "yes"** (§2). That's the last line where a hallucinated event gets caught
before it becomes a public commit. This is why the site publish is gated by default,
not autonomous.

**Optional hardening (flag it if you want it built):** a lightweight
`_grounding_check(draft, context)` that flags a draft mentioning concrete event-like
claims (`follow`/`survey`/`drove`/named places) with no corresponding journal/memory
line, and downgrades to "read this back and confirm it's true" instead of publishing.
It's a heuristic, not a proof — the human gate remains the real guarantee — but it
catches the obvious confabulations automatically. Recommend building it alongside.

**Honest limitation:** grounding makes fabrication unlikely and easy to catch; it does
not make it *impossible* at the model layer. The guarantee that nothing false goes
public is the human "yes," not the prompt. I want that stated plainly before you wire
it in.

## 3. Status header freshness — `_write_site_status()`

The header is just `data/status.json`. Buddy keeps it current by rewriting that file
and pushing it on a **throttled** cadence — the tricky part is not flooding git
history with a commit every tick.

```
_write_site_status(force=False):
  snap = {name, unit, bio,
          dials:{humor,sarcasm,honesty},   # the mk140 persona dials
          battery_pct, mode, last_active: now}
  write snap -> <repo>/data/status.json     # cheap local write, every call is fine
  # PUSH is the throttled part:
  if force or (materially changed vs last-pushed AND
               now - last_status_push >= BUDDY_SITE_STATUS_MIN_INTERVAL):
      _site_git("add", "data/status.json")
      _site_git("commit", "-m", "status: refresh")
      if BUDDY_SITE_PUSH: _site_git("push")
      last_status_push = now
```

- **Where it's driven:** a low-frequency call from an existing loop tick
  (`companion_loop` already runs and is the natural home) — no new thread.
- **"Materially changed"** compares the *stable* fields (dials, mode, battery bucket),
  not `last_active` (which always differs), so an idle Buddy doesn't commit every
  interval just because the clock moved. The `min-interval` is the hard floor either
  way. Default 30 min ⇒ at most ~48 status commits/day, and usually far fewer.
- **Piggyback option:** to keep history even cleaner, `publish_to_site` can fold the
  current status.json into the *same* commit as a new post, so status only ever rides
  along with real content. Offered as a flag; recommend leaving the throttled
  standalone push on so the header doesn't go stale between posts.
- **Latency note:** GitHub Pages redeploys ~1 min after a push, so the live header is
  "current within one push interval + ~1 min," never real-time. That's appropriate for
  a public page and keeps commit volume sane.

## 4. Tests (mirroring the project's style)

- `git` calls mocked (like the Moltbook tests mock the client) — **no network, no real
  repo** in the suite. Assert: posts.json gets the new entry prepended with a
  monotonic id; atomic write; `_site_git` invoked with `add/commit/push` in order and
  `-C <repo>` always present; disabled/`BUDDY_SITE_ENABLED=0` makes zero git calls;
  push-failure-after-commit surfaces as "committed, not pushed".
- Status: `min-interval` and change-detection gate the push; local write always happens.

## 5. What I'd add to buddy.py (for the approved build)

- `publish_to_site`, `compose_site_post` (the grounded composer, §2.5),
  `_write_site_status`, `_site_git`, `handle_site_command` + a draft/confirm pending
  slot (`_site_pending`), and a `detect_site_intent` next to the other
  `detect_*_intent` blocks. Optionally `_grounding_check` (§2.5 hardening).
- New env flags read once at module load.
- A new `tests/test_site_publish.py`, including a test that a composer given an EMPTY
  journal/memory context produces an honest "nothing to report" draft and asserts no
  fabricated event vocabulary appears — i.e. grounding is covered, not just plumbing.
- **No changes** to any Moltbook file, motor path, or the verification flow.

Awaiting your approval before writing any of the buddy.py side.
