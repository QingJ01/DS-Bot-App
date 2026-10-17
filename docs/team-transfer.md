# Back up and move a team

A team is worth keeping: the Bots, what each one was told to do, which model it runs on, where
it works, its permissions and its daily budget. **Export** writes all of that to one file, and
**import** puts it back — on the same DSH or on another machine.

```sh
# Write a backup into <home>/exports/ and answer with it
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"team-export","payload":{}}'

# Put a backup back: either the export itself, or the file name in that folder
curl -s localhost:PORT/api/bot -H 'content-type: application/json' \
  -d '{"endpoint":"team-import","payload":{"path":"team-2026-10-17T09-12-00-000Z.json"}}'
```

`<home>` is the DS Bot data folder (`~/.dsh/bot/` on Linux and macOS, `C:\Users\<user>\.dsh\bot\`
on Windows). An export is also a plain JSON file, so it can be committed to a private
repository, encrypted, or carried on a disk — treat it like the notes it is: instructions and
names, no keys.

## What travels

| Travels | Does not travel |
| --- | --- |
| Each Bot: name, role, instructions, look, model, thinking level, permission preset, working folder, daily budget, capabilities | Session ids and conversation history |
| Each group: name, members, admin, reply mode, notice, working folder, permission preset | The exchanges between Bots, and the questions a Session answered |
| — | Secrets (they live in `secrets.json` and never leave the host) |
| — | Memory: `memory/bots/<id>/MEMORY.md` and its topics belong to the Bot's own history |

A Bot that arrives is a Bot with the same settings and **a fresh conversation**. That is the
point of an export: the setup is what you tuned. To move a Bot's memory too, copy its
`memory/bots/<id>/` folder beside the new Bot's id after the import.

## How an import behaves

- **Bots are added, never replaced.** A name already on the team is kept apart: the imported
  Bot becomes `Writer 2`, and the Bot that was here is untouched.
- **A group is made from the members this host has.** A member the team does not have is
  reported and left out; a group left with fewer than two members is skipped rather than made
  half a group. A group name that is taken becomes `Crew (imported)`.
- **A model this host does not serve, or a folder it does not have, is reported and left
  out.** The Bot still arrives: it waits for you to pick a model, exactly as a Bot made
  without one does, and it works in the team workspace.
- **A capability this host does not have is reported and left out**; the rest of the Bot's
  settings are still applied.
- **Nothing is half-done silently.** Every departure from the file comes back as a note with
  the Bot or group it belongs to.
- Only a host that owns the team may import. A host that is watching another dsh's team can
  still export, because that is a read.

## What to watch

- **An import is not a merge.** Two teams' worth of Bots, each with its own Main Bot rules and
  its own memory, become one team of ordinary Bots. Promote the Main Bots you want afterwards
  (a Bot's details, **Main Bot**).
- **Instructions can be long.** An export carries them whole; it is a file the user asked for,
  not a wire format.
- **The file lives on the host.** Import reads a name inside `<home>/exports/`, never an
  arbitrary path: an import must not be a way to read any file the host can read.
