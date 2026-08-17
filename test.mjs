// Offline check: runs index.js through the same wrapper Revenge's loader uses,
// with real spitroast and a fake FriendsStore shaped like the desktop one.
// Proves section gating + both ignored-detection paths. Does NOT prove the real
// Android app has this shape — that needs a device.
// Run: node test.mjs   (needs: npm i spitroast)
import { readFileSync } from "fs";
import assert from "assert";
// spitroast 2.1.6's package.json "main" points at a file it doesn't ship, hence the deep import
import { after } from "spitroast/dist/index.mjs";

const src = readFileSync("builds/hideignoredfriends/index.js", "utf8");
const instantiate = new Function("bunny", "definePlugin", `${src};return plugin?.default ?? plugin;`);

const ROWS = [
    { userId: "1", type: 1, ignoredUser: false },
    { userId: "2", type: 1, ignoredUser: true }
];

function makeBunny({ rows = ROWS, relationshipStore = null } = {}) {
    const logs = [];
    // Mirrors Discord's rows container: filter() lives on the prototype.
    class Rows {
        constructor(r) { this._rows = r; }
        filter(section) { return section === "PENDING_IGNORED" ? this._rows.filter(r => r.ignoredUser) : this._rows; }
    }
    const stores = { FriendsStore: { getState: () => ({ rows: new Rows(rows) }) }, RelationshipStore: relationshipStore };
    return {
        logs,
        bunny: {
            metro: { findByStoreName: n => stores[n], common: { clipboard: { setString() {} } } },
            api: { patcher: { after } },
            ui: { toasts: { showToast() {} } },
            plugin: { logger: { log: m => logs.push(m) } }
        }
    };
}

const define = p => p;

// 1. ignoredUser rows are dropped from ONLINE and ALL, kept in the Ignored tab
{
    const { bunny, logs } = makeBunny();
    const p = instantiate(bunny, define);
    p.start();
    const rows = bunny.metro.findByStoreName("FriendsStore").getState().rows;
    assert.deepEqual(rows.filter("ONLINE").map(r => r.userId), ["1"], "ONLINE should drop ignored");
    assert.deepEqual(rows.filter("ALL").map(r => r.userId), ["1"], "ALL should drop ignored");
    assert.deepEqual(rows.filter("PENDING_IGNORED").map(r => r.userId), ["2"], "Ignored tab must keep them");
    assert.deepEqual(rows.filter("PENDING").map(r => r.userId), ["1", "2"], "PENDING untouched");
    assert.deepEqual(logs, [], "no diagnostics on the happy path");
}

// 2. rows without ignoredUser fall back to RelationshipStore.isIgnored, and say so
{
    const { bunny, logs } = makeBunny({
        rows: [{ userId: "1", type: 1 }, { userId: "2", type: 1 }],
        relationshipStore: { isIgnored: id => id === "2" }
    });
    const p = instantiate(bunny, define);
    p.start();
    const rows = bunny.metro.findByStoreName("FriendsStore").getState().rows;
    assert.deepEqual(rows.filter("ALL").map(r => r.userId), ["1"], "fallback should drop ignored");
    assert.match(logs[0] ?? "", /no ignoredUser/, "should report the fallback");
}

// 3. missing FriendsStore reports instead of throwing
{
    const { bunny, logs } = makeBunny();
    bunny.metro.findByStoreName = () => undefined;
    instantiate(bunny, define).start();
    assert.match(logs[0] ?? "", /no FriendsStore/);
}

// 4. an unexpected section value is reported, not silently ignored
{
    const { bunny, logs } = makeBunny();
    instantiate(bunny, define).start();
    bunny.metro.findByStoreName("FriendsStore").getState().rows.filter(3);
    assert.match(logs[0] ?? "", /unexpected section value 3/);
}

console.log("ok: 4/4 — section gating, ignoredUser + isIgnored paths, and both failure reports");
