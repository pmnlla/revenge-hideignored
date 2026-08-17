# HideIgnoredFriends

A [Revenge](https://github.com/revenge-mod/revenge-bundle) plugin repository. One plugin:
hides users you've ignored from the friends list, in the **Online** and **All** tabs.

Pending / Spam / Ignored tabs are left alone on purpose — the Ignored tab exists to show
those people.

## Install

Revenge → Settings → **Plugin Browser** → **Add Repository**:

```
https://raw.githubusercontent.com/pmnlla/revenge-hideignored/master/repo.json
```

Then install **HideIgnoredFriends** from the list.

## Status

The desktop [Vencord](https://github.com/Vendicated/Vencord) version of this was verified
against Discord's real web bundle. This port could not be: Discord Android is Hermes-compiled,
so the assumption that `FriendsStore.getState().rows` has a prototype `filter(section)` is
unverified until it runs on a device.

The plugin therefore checks that assumption at runtime. If the store is missing, the method is
missing, rows don't carry `ignoredUser`, or a section value isn't a recognised string, it logs
the details and copies them to your clipboard with a toast, rather than silently doing nothing.

## Layout

Paths are fixed by Revenge's plugin loader — `repo.json` at the base, plugins under
`builds/<id>/`, and `<id>` must match in both files.

```
repo.json
builds/hideignoredfriends/
├── manifest.json
└── index.js
```

`repo.json` sets `alwaysFetch: true`, so a refresh in-app picks up edits without a version bump.

## Dev

`index.js` is plain JS with no build step: Revenge evals it as
`(bunny,definePlugin)=>{ <script> ;return plugin?.default ?? plugin}`, so the script just has to
declare `plugin`.

```sh
npm i          # spitroast, for the test only
node test.mjs  # runs index.js through that same wrapper against a fake store
```

The test proves the filtering logic and both failure reports. It cannot prove the real app has
the shape it assumes — that needs a device.
