// Offline check: runs index.js through the exact string Revenge's Vendetta-compat
// loader evals, with real spitroast and a fake FriendsStore shaped like desktop's.
// Proves section gating, both ignored-detection paths, unload, and the failure reports.
// Does NOT prove the real Android app has this shape — that needs a device.
// Run: npm test
import { readFileSync } from "fs";
import assert from "assert";
// spitroast 2.1.6's package.json "main" points at a file it doesn't ship, hence the deep import
import { after } from "spitroast/dist/index.mjs";

const js = readFileSync("index.js", "utf8");

// Verbatim from rv/src/core/vendetta/plugins.ts evalPlugin()
function load(vendetta) {
    const raw = new Function("vendetta", `return ${js}`)(vendetta);
    const ret = typeof raw === "function" ? raw() : raw;
    return ret?.default ?? ret ?? {};
}

const ROWS = [
    { userId: "1", type: 1, ignoredUser: false },
    { userId: "2", type: 1, ignoredUser: true }
];

function makeVendetta({ rows = ROWS, relationshipStore = null } = {}) {
    const logs = [];
    // Mirrors Discord's rows container: filter() lives on the prototype.
    class Rows {
        constructor(r) { this._rows = r; }
        filter(section) { return section === "PENDING_IGNORED" ? this._rows.filter(r => r.ignoredUser) : this._rows; }
    }
    const stores = { FriendsStore: { getState: () => ({ rows: new Rows(rows) }) }, RelationshipStore: relationshipStore };
    // Stands in for the metro registry the probe walks.
    const modules = [
        { getName: () => "RelationshipStore" },
        { getName: () => "UserStore" },
        { getName: () => "FriendsRowStore" },
        { getName() { throw new Error("lazy module exploded"); } },
        { useFriendsList: () => [] }
    ];
    return {
        logs,
        Rows,
        vendetta: {
            patcher: { after },
            metro: {
                findByStoreName: n => stores[n],
                findAll: pred => { modules.forEach(m => pred(m)); return []; },
                common: { clipboard: { setString() {} } }
            },
            ui: { toasts: { showToast() {} } },
            logger: { log: m => logs.push(m) }
        }
    };
}

const rowsOf = v => v.metro.findByStoreName("FriendsStore").getState().rows;

// 1. ignored rows dropped from Online/All, kept everywhere else
{
    const t = makeVendetta();
    load(t.vendetta).onLoad();
    const rows = rowsOf(t.vendetta);
    assert.deepEqual(rows.filter("ONLINE").map(r => r.userId), ["1"], "ONLINE should drop ignored");
    assert.deepEqual(rows.filter("ALL").map(r => r.userId), ["1"], "ALL should drop ignored");
    assert.deepEqual(rows.filter("PENDING_IGNORED").map(r => r.userId), ["2"], "Ignored tab must keep them");
    assert.deepEqual(rows.filter("PENDING").map(r => r.userId), ["1", "2"], "PENDING untouched");
    assert.deepEqual(t.logs, [], "no diagnostics on the happy path");
}

// 2. onUnload restores the original filter (no auto-dispose in this loader)
{
    const t = makeVendetta();
    const p = load(t.vendetta);
    p.onLoad();
    assert.equal(rowsOf(t.vendetta).filter("ALL").length, 1, "patched");
    p.onUnload();
    assert.equal(rowsOf(t.vendetta).filter("ALL").length, 2, "onUnload must restore the original filter");
}

// 3. rows without ignoredUser fall back to RelationshipStore.isIgnored, and say so
{
    const t = makeVendetta({
        rows: [{ userId: "1", type: 1 }, { userId: "2", type: 1 }],
        relationshipStore: { isIgnored: id => id === "2" }
    });
    load(t.vendetta).onLoad();
    assert.deepEqual(rowsOf(t.vendetta).filter("ALL").map(r => r.userId), ["1"], "fallback should drop ignored");
    assert.match(t.logs[0] ?? "", /no ignoredUser/, "should report the fallback");
}

// 4. missing FriendsStore reports, and the probe dumps what the build does have
{
    const t = makeVendetta();
    t.vendetta.metro.findByStoreName = () => undefined;
    load(t.vendetta).onLoad();
    const dump = t.logs[0] ?? "";
    assert.match(dump, /no FriendsStore/);
    assert.match(dump, /stores total: 3/, "should count stores, skipping the one that throws");
    assert.match(dump, /store matches: \[FriendsRowStore,RelationshipStore\]/, "should filter to relevant names");
    assert.match(dump, /RelationshipStore: not found/);
    assert.match(dump, /friend-ish exports: \[useFriendsList\]/);
}

// 5. an unexpected section value is reported, not silently ignored
{
    const t = makeVendetta();
    load(t.vendetta).onLoad();
    rowsOf(t.vendetta).filter(3);
    assert.match(t.logs[0] ?? "", /unexpected section value 3/);
}

// 6. the file is a single expression starting at line 1 col 1 — a leading comment or
//    newline would make `return\n...` hit ASI and silently load an empty plugin
assert.ok(/^\(/.test(js), "index.js must start with '(' or the loader's return hits ASI");

console.log("ok: 6/6 — gating, both ignored paths, unload, failure reports, ASI guard");
