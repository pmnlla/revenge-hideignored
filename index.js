(function () {
    // HideIgnoredFriends — Vendetta-format plugin for Revenge.
    // Hides ignored users from the friends list, Online + All tabs only.
    //
    // NOTE: this file must stay a single expression starting on line 1 column 1.
    // Revenge evals it as `vendetta=>{return <this file>}`, so a leading comment or
    // blank line would trigger ASI after `return` and silently load nothing.

    var patcher = vendetta.patcher;
    var metro = vendetta.metro;
    var logger = vendetta.logger;

    // Section values are plain strings ("ONLINE", "ALL", ...).
    var SECTIONS = ["ONLINE", "ALL", "PENDING", "PENDING_IGNORED", "SPAM", "SUGGESTIONS", "ADD_FRIEND"];

    var reported = false;
    function report(msg) {
        if (reported) return;
        reported = true;
        logger.log("[HideIgnoredFriends] " + msg);
        try {
            metro.common.clipboard.setString("HideIgnoredFriends: " + msg);
            vendetta.ui.toasts.showToast("HideIgnoredFriends: unexpected shape, details copied to clipboard");
        } catch (e) {
            // toast/clipboard are best-effort; the logger line is the real record
        }
    }

    // Called when the expected store isn't there: dump what this build actually has,
    // so the next version can target it instead of guessing again.
    function probe() {
        var lines = [];
        var names = [];

        try {
            var seen = {};
            metro.findAll(function (m) {
                try {
                    if (m && typeof m.getName === "function" && m.getName.length === 0) {
                        var n = m.getName();
                        if (typeof n === "string") seen[n] = 1;
                    }
                } catch (e) { /* lazy module blew up on access; skip it */ }
                return false;
            });
            names = Object.keys(seen).sort();
        } catch (e) {
            lines.push("store scan failed: " + e);
        }

        lines.push("stores total: " + names.length);
        lines.push("store matches: [" + names.filter(function (n) { return /friend|relation|ignor/i.test(n); }) + "]");

        var rs = metro.findByStoreName("RelationshipStore");
        if (rs) {
            var keys = [];
            for (var o = rs; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
                keys = keys.concat(Object.getOwnPropertyNames(o));
            }
            lines.push("RelationshipStore: [" + keys.filter(function (k) {
                return /ignor|blocked|friend|relationship/i.test(k);
            }).sort() + "]");
        } else {
            lines.push("RelationshipStore: not found");
        }

        try {
            var props = {};
            metro.findAll(function (m) {
                if (m && typeof m === "object") {
                    try {
                        Object.keys(m).forEach(function (k) { if (/friend/i.test(k)) props[k] = 1; });
                    } catch (e) { /* exotic export; skip */ }
                }
                return false;
            });
            lines.push("friend-ish exports: [" + Object.keys(props).sort().slice(0, 60) + "]");
        } catch (e) {
            lines.push("export scan failed: " + e);
        }

        return lines.join("\n");
    }

    // Desktop rows carry ignoredUser; ask the store if this build's rows don't.
    function isIgnored(row) {
        if ("ignoredUser" in row) return !!row.ignoredUser;
        var id = row.userId != null ? row.userId : row.user && row.user.id;
        var store = metro.findByStoreName("RelationshipStore");
        return !!(id && store && store.isIgnored && store.isIgnored(id));
    }

    var unpatch;

    return {
        onLoad() {
            var FriendsStore = metro.findByStoreName("FriendsStore");
            if (!FriendsStore) return report("no FriendsStore in this build\n" + probe());

            var state = FriendsStore.getState && FriendsStore.getState();
            var rowsProto = state && state.rows && Object.getPrototypeOf(state.rows);

            if (!rowsProto || typeof rowsProto.filter !== "function") {
                return report(
                    "no rows.filter() — state keys: [" + Object.keys(state || {}) + "], rows proto: ["
                    + (rowsProto ? Object.getOwnPropertyNames(rowsProto) : "none") + "]"
                );
            }

            unpatch = patcher.after("filter", rowsProto, function (args, rows) {
                var section = args[0];

                if (SECTIONS.indexOf(section) === -1) return report("unexpected section value " + JSON.stringify(section));
                // Leave Pending/Spam/Ignored alone — the Ignored tab exists to show these people.
                if (section !== "ONLINE" && section !== "ALL") return;
                if (!Array.isArray(rows)) return report("filter() returned " + typeof rows + ", not an array");

                if (rows.length && !("ignoredUser" in rows[0])) {
                    report("rows have no ignoredUser; keys: [" + Object.keys(rows[0]) + "] — using RelationshipStore.isIgnored instead");
                }

                return rows.filter(function (row) { return !isIgnored(row); });
            });
        },

        // Vendetta-compat patches are raw spitroast, not auto-disposed like Bunny's.
        onUnload() {
            if (unpatch) unpatch();
            unpatch = undefined;
        }
    };
})
