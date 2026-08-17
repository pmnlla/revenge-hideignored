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

    // This build has no rows-container store, so find what actually feeds the list.
    // Buckets are narrow on purpose: the first pass hit a flat cap and truncated
    // alphabetically at "c", hiding every use*/get* name.
    function probe() {
        var lines = [];
        var keys = {};

        try {
            metro.findAll(function (m) {
                if (m && typeof m === "object") {
                    try {
                        Object.keys(m).forEach(function (k) { keys[k] = 1; });
                    } catch (e) { /* exotic export; skip */ }
                }
                return false;
            });
        } catch (e) {
            lines.push("export scan failed: " + e);
        }

        var all = Object.keys(keys).sort();
        function bucket(label, re, cap) {
            var hits = all.filter(function (k) { return re.test(k); });
            lines.push(label + " (" + hits.length + "): [" + hits.slice(0, cap || 40) + "]");
        }

        lines.push("exported keys total: " + all.length);
        bucket("hooks", /^use.*(friend|relationship|ignor)/i);
        bucket("getters", /^get.*(friend|relationship)/i);
        bucket("rowish", /(friend|relationship).*(row|list|item|section|screen|tab)|(row|list|screen).*(friend|relationship)/i, 60);

        try {
            var sections = metro.findByProps("FriendsSections");
            lines.push("FriendsSections: " + JSON.stringify(sections && sections.FriendsSections));
        } catch (e) {
            lines.push("FriendsSections lookup failed: " + e);
        }

        return lines.join("\n");
    }

    // Fallback for builds with no rows container: the list is most likely derived from
    // RelationshipStore.getFriendIDs(). Filtering there is a blunter instrument than the
    // desktop patch — it drops ignored users from anything reading that list, not just
    // the two tabs — but it needs no knowledge of the UI layer.
    function hideViaFriendIds(rs) {
        if (!rs || typeof rs.getFriendIDs !== "function" || typeof rs.isIgnored !== "function") return false;
        unpatch = patcher.after("getFriendIDs", rs, function (args, ids) {
            if (!Array.isArray(ids)) return;
            return ids.filter(function (id) { return !rs.isIgnored(id); });
        });
        return true;
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
            if (!FriendsStore) {
                var applied = hideViaFriendIds(metro.findByStoreName("RelationshipStore"));
                return report(
                    "no FriendsStore in this build; "
                    + (applied ? "filtering RelationshipStore.getFriendIDs instead" : "getFriendIDs fallback unavailable too")
                    + "\n" + probe()
                );
            }

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
