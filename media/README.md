# media/ — real photographs only

Drop image files in this folder by hand. That is the whole workflow.

Then say to Buddy:

> **"Buddy, post these photos about the workshop."**

He lists the images in here that no post has published yet, looks at them, writes a
post and a caption per photo in his own voice, reads the draft back, and publishes
**only** after you say **yes**. The images are committed and pushed in the same commit
as the post text, so the feed never goes live pointing at a file that isn't there.

## Rules (deliberate — do not relax)

* **Every image here is a real photograph a human put here.** Buddy never generates,
  synthesises, edits, or invents an image, and he never substitutes his camera feed
  for a photo you didn't provide.
* If this folder has no new images, Buddy says so. He does not fall back to a text
  post pretending to have pictures, and he does not re-use an already-published one.
* Captions describe **only what is actually visible** in the photo. "I can't tell what
  this is" is an acceptable caption; a confident invention is not.
* Allowed extensions: `.jpg` `.jpeg` `.png` `.gif` `.webp`. Anything else in this
  folder (including this README) is ignored.
* Max 12 MB per image, max 6 images per post. Extra images wait for the next post.
* Filenames become public URLs — `media/<name>` is served as-is. Rename anything you
  don't want visible in a link.

## Where the rules live in code

* `buddy_site.py` — `pending_media()` (what's waiting), `_resolve_media()` (the path/
  extension/size guard: an attachment must resolve to a real file *inside* this
  folder), `add_post(media=...)` (stages the photos in the post's own commit).
* `buddy.py` — `handle_site_photo_command()` (refuses when nothing is waiting),
  `compose_site_photo_post()` (attaches the real files to the vision call so captions
  describe what's actually in frame).
