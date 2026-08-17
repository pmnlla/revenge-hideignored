// HideIgnoredFriends — Revenge / Bunny plugin (spec 3)
// Hides ignored users from the friends list, Online + All tabs only.
//
// Ported from the Vencord version, which patches FriendsStore's per-section row
// predicate. Discord Android is Hermes-compiled, so unlike the desktop patch this
// one could not be verified against real code offline: every assumption below is
// checked at runtime and reports what it actually found (toast + clipboard) rather
// than failing silently.
//
// Loader contract: the script is eval'd as `(bunny,definePlugin)=>{ <this> ;return plugin?.default ?? plugin}`

const { metro, api: { patcher }, ui: { toasts }, plugin: { logger } } = bunny;

// Section values are plain strings on desktop ("ONLINE", "ALL", ...).
const SECTIONS = ["ONLINE", "ALL", "PENDING", "PENDING_IGNORED", "SPAM", "SUGGESTIONS", "ADD_FRIEND"];

let reported = false;
function report(msg) {
    if (reported) return;
    reported = true;
    logger.log("[HideIgnoredFriends] " + msg);
    try {
        metro.common.clipboard.setString("HideIgnoredFriends: " + msg);
        toasts.showToast("HideIgnoredFriends: unexpected shape, details copied to clipboard");
    } catch (e) {
        // toast/clipboard are best-effort; the logger line is the real record
    }
}

// Desktop rows carry ignoredUser; ask the store if this build's rows don't.
function isIgnored(row) {
    if ("ignoredUser" in row) return !!row.ignoredUser;
    const id = row.userId ?? row.user?.id;
    return !!(id && metro.findByStoreName("RelationshipStore")?.isIgnored?.(id));
}

var plugin = definePlugin({
    start() {
        const FriendsStore = metro.findByStoreName("FriendsStore");
        if (!FriendsStore) return report("no FriendsStore in this build");

        const state = FriendsStore.getState?.();
        const rowsProto = state?.rows && Object.getPrototypeOf(state.rows);

        if (typeof rowsProto?.filter !== "function") {
            return report(
                "no rows.filter() — state keys: [" + Object.keys(state ?? {}) + "], rows proto: ["
                + (rowsProto ? Object.getOwnPropertyNames(rowsProto) : "none") + "]"
            );
        }

        patcher.after("filter", rowsProto, (args, rows) => {
            const section = args[0];

            if (!SECTIONS.includes(section)) return report("unexpected section value " + JSON.stringify(section));
            // Leave Pending/Spam/Ignored alone — the Ignored tab exists to show these people.
            if (section !== "ONLINE" && section !== "ALL") return;
            if (!Array.isArray(rows)) return report("filter() returned " + typeof rows + ", not an array");

            if (rows.length && !("ignoredUser" in rows[0])) {
                report("rows have no ignoredUser; keys: [" + Object.keys(rows[0]) + "] — using RelationshipStore.isIgnored instead");
            }

            return rows.filter(row => !isIgnored(row));
        });
    }
});
