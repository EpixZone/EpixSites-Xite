const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const A = 'epix1jaahfehr280m9uqlf44vtkrz9hjkvq8fewz68v';
const B = 'epix1p0stmcza0xjkvv0vnjlk0ypr7xsunt4lxkhgcm';
const C = 'epix1searchd8hcnyfacvklmszzxwx9ptnf5rde04xf';
const key = address => crypto.createHash('sha256').update(String(address)).digest('hex');

function harness() {
  const calls = [];
  const decisions = new Map();
  const policy = {
    state: 'allowed', entries: [],
    key, records() { return this.entries; },
    check(address) { return !address ? {status: 'verification_unavailable'} : decisions.get(address) || {status: this.state}; },
    guard(address, cb) { cb({...this.check(address), canonicalAddress: address}); },
    ready() { return Promise.resolve(); },
    prepare() { return Promise.resolve(); }
  };
  class Menu { constructor() { this.items = []; } render() { return null; } }
  class Form { constructor() { this.data = {}; this.invalid = {}; } }
  class ItemList {
    constructor(Item) { this.Item = Item; this.items = []; }
    sync(rows) { this.items = rows.map(row => new this.Item(row)); }
  }
  const noop = () => {};
  const context = {
    console, setTimeout, clearTimeout, Map, Set,
    crypto: crypto.webcrypto,
    _: (text, values) => text.replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? `{${name}}`),
    _n: (n, one, many, values) => (n === 1 ? one : many).replace(/\{(\w+)\}/g, (_, name) => name === 'n' ? n : values?.[name] ?? ''),
    h: (tag, ...args) => ({tag, args}),
    LogMixin: {log: noop, logStart: noop, logEnd: noop},
    Time: {timestamp: () => 100000},
    Animation: {}, Menu, Form, ItemList,
    isEmpty: object => !Object.keys(object).length,
    Text: {fileEncode: value => JSON.stringify(value), formatUsername: value => value},
    RemovalPolicy: policy,
    Page: {
      site_info: {address: C, cert_user_id: 'me.epix@xid.epix', content: {settings: {editors: [], trust: {}}}},
      projector: {scheduleRender: noop}, on_loaded: {resolve: noop},
      on_site_info: {then: noop}, on_local_storage: {then: noop},
      local_storage: {}, categories: [[1, 'Files']], head: {active: 'flagged'},
      cmd(command, params, cb) { calls.push({command, params}); if (cb) cb(command === 'recordSign' ? params[0] : 'ok'); },
      user: {my_ratings: {}, starred: {}, my_reports: {}, my_vouches: {}, my_claims: {}, getUserDirectory: () => 'me.epix'},
      returnFalse: () => false
    },
    document: {createElement: () => { throw new Error('Unexpected navigation or copy'); }}
  };
  context.window = context;
  context.innerWidth = 1000;
  vm.createContext(context);
  ['js/utils/Trust.js', 'js/utils/Claim.js', 'js/utils/SiteRemoval.js', 'js/Site.js',
    'js/SiteAdd.js', 'js/SiteLists.js', 'js/ClaimForm.js', 'js/User.js'].forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
  });
  const lists = context.Page.site_lists = Object.create(context.SiteLists.prototype);
  Object.assign(lists, {
    filter_lang: {}, hide_adult: true, site_lists_db: {}, rows: [], trust: {}, claims: {}, removals: [],
    search_text: '', search_list: new ItemList(context.Site), flagged_list: new ItemList(context.Site)
  });
  function apply(rows, reports = []) {
    lists.applyResults({sites: rows, claims: [], ratings: [], reports, stars: []});
  }
  return {context, policy, decisions, calls, lists, apply};
}

function row(address = A, id = 1, extras = {}) {
  return {address, site_id: id, directory: 'author.epix', title: 'SECRET TITLE',
    description: 'SECRET DESCRIPTION', tags: 'SECRET TAG', rating: 'g', category: 1,
    language: 'en', date_added: 99999, ...extras};
}

function assertNoTarget(tree) {
  const text = JSON.stringify(tree);
  for (const value of [A, 'SECRET TITLE', 'SECRET DESCRIPTION', 'SECRET TAG', 'author.epix']) {
    assert.equal(text.includes(value), false, `rendered target data: ${value}`);
  }
  assert.equal(text.includes('href'), false);
  assert.equal(text.includes('onclick'), false);
  return text;
}

test('registry removals are address-free and survive loss of the original listing', () => {
  const h = harness();
  const record = {status: 'removed', removedKey: key(A), reasonCode: 'malware', title: 'SECRET TITLE', address: A};
  h.policy.entries = [record];
  h.decisions.set(A, record);
  h.apply([row()]);
  assert.equal(h.lists.rows.length, 0);
  assert.equal(h.lists.searchRows(A).length, 0);
  assert.equal(h.lists.removals.length, 1);
  assertNoTarget(h.context.SiteRemoval.render(h.lists.removals[0]));
  h.apply([]);
  assert.equal(h.lists.removals.length, 1);
  assert.equal(h.lists.flagged_count, 1);
  const add = new h.context.SiteAdd();
  assert.match(add.shouldBeUniqueSite(A), /Malware/);
  h.apply([row(A, 999)]);
  assert.equal(h.lists.rows.length, 0, 'new listing IDs cannot bypass address removal');
});

test('community delisting sanitizes every duplicate address and preserves ordinary warnings', () => {
  const h = harness();
  const reports = Array.from({length: 5}, (_, index) => ({target_dir: 'author.epix', target_site_id: 1,
    author: `reporter${index}.epix`, kind: 'report', reason: 'malware', note: A}));
  h.apply([row(), row(A, 2), row(B, 3, {title: 'Visible', description: '', tags: ''})], reports);
  assert.equal(h.lists.rows.length, 1);
  assert.equal(h.lists.rows[0].address, B);
  assert.equal(h.lists.removals.length, 1);
  assertNoTarget(h.context.SiteRemoval.render(h.lists.removals[0]));
  assertNoTarget(new h.context.Site(row()).render());
  h.apply([row()], reports.slice(0, 2));
  assert.equal(h.lists.removals.length, 0);
  assert.equal(h.lists.rows.length, 1);
  assert.equal(h.lists.flagged_list.items.length, 1);
  assert.equal(h.lists.trust['author.epix_1'].state, 'warned');
});

test('unavailable verification hides projections and never becomes a removal allegation', () => {
  const h = harness();
  h.policy.state = 'verification_unavailable';
  h.apply([row()]);
  assert.equal(h.lists.rows.length, 0);
  assert.equal(h.lists.policy_unavailable, true);
  assert.equal(h.lists.removals.length, 0);
  assertNoTarget(new h.context.Site(row()).render());
  const claim = new h.context.ClaimForm({row: row()});
  assertNoTarget(claim.render());
  claim.handleCopy({currentTarget: {attributes: {'data-copy': {value: 'command'}}}});
  assert.equal(h.calls.some(call => call.command === 'ecdsaVerify'), false);
});

test('verification retry preserves its event handler across renders and updates after refresh', async () => {
  const h = harness();
  const lists = new h.context.SiteLists();
  lists.site_add.render = () => null;
  lists.renderSkeleton = () => null;
  const button = tree => tree.args[2].args[1][1];
  const first = button(lists.render());
  const second = button(lists.render());
  assert.equal(first.args[0].onclick, second.args[0].onclick);
  let updated = 0;
  lists.update = () => updated++;
  let resolve;
  h.policy.refresh = () => new Promise(done => { resolve = done; });
  assert.equal(first.args[0].onclick(), false);
  assert.equal(updated, 0);
  resolve();
  await Promise.resolve();
  assert.equal(updated, 1);
});

test('active removal and unknown policy gate opens, claims and edits', () => {
  for (const status of ['removed', 'verification_unavailable']) {
    const h = harness();
    h.decisions.set(A, {status, removedKey: key(A), reasonCode: 'malware'});
    const site = new h.context.Site(row());
    site.handleOpenClick({preventDefault() {}});
    site.saveRow(() => {});
    site.handleClaimClick();
    assert.equal(h.calls.some(call => ['wrapperConfirm', 'recordSign', 'fileWrite'].includes(call.command)), false);
  }
});

test('writes recheck policy after reads and signatures, and canonicalize accepted aliases', () => {
  const h = harness();
  const user = new h.context.User();
  user.getPath = () => 'data/users/me.epix';
  user.ensureCollections = cb => cb();
  user.getRecords = (collection, cb) => cb({post: []});
  h.policy.guard = (address, cb) => cb({...h.policy.check(address), canonicalAddress: address === 'name.epix' ? B : address});
  let result;
  user.editRecord('sites', 'site_1', {address: 'name.epix', title: 'Test'}, false, value => result = value);
  assert.equal(result, 'ok');
  const written = JSON.parse(h.calls.find(call => call.command === 'fileWrite').params[1]);
  assert.equal(written.post[0].address, B);
  h.calls.length = 0;
  user.getRecords = (collection, cb) => {
    h.decisions.set(A, {status: 'removed', removedKey: key(A), reasonCode: 'malware'});
    cb({post: []});
  };
  user.editRecord('sites', 'site_2', {address: A}, false, value => result = value);
  assert.match(result.error, /removed/);
  assert.equal(h.calls.some(call => call.command === 'recordSign'), false);
  h.decisions.delete(A);
  user.getRecords = (collection, cb) => cb({post: []});
  h.context.Page.cmd = (command, params, cb) => {
    h.calls.push({command, params});
    if (command === 'recordSign') {
      h.policy.state = 'verification_unavailable';
      cb(params[0]);
    }
  };
  user.editRecord('claims', 'claim_' + A, {target_address: A}, false, value => result = value);
  assert.match(result.error, /could not be verified/);
  assert.equal(h.calls.some(call => call.command === 'fileWrite'), false);
});

test('an unsuccessful fresh guard cannot reuse a stale allowed decision', () => {
  const h = harness();
  h.policy.guard = (address, cb) => cb({status: 'verification_unavailable'});
  let decision;
  h.context.SiteRemoval.guard(A, value => decision = value);
  assert.equal(decision.status, 'verification_unavailable');
});

test('stale judgments cannot publish after removal, while withdrawal remains possible', () => {
  const h = harness();
  h.apply([row()]);
  const user = new h.context.User();
  user.getPath = () => 'data/users/me.epix';
  user.ensureCollections = cb => cb();
  user.getRecords = (collection, cb) => cb({post: []});
  h.decisions.set(A, {status: 'removed', removedKey: key(A), reasonCode: 'malware'});
  h.apply([row()]);
  let result;
  user.editRecord('reports', 'report_author.epix_1', {
    target_dir: 'author.epix', target_site_id: 1, kind: 'report', reason: 'malware', note: A
  }, false, value => result = value);
  assert.match(result.error, /could not be verified/);
  assert.equal(h.calls.some(call => call.command === 'recordSign'), false);
  user.editRecord('reports', 'report_author.epix_1', {}, true, value => result = value);
  assert.equal(result, 'ok');
  const written = JSON.parse(h.calls.find(call => call.command === 'fileWrite').params[1]);
  assert.equal(written.post[0].deleted, true);
  assert.equal(JSON.stringify(written).includes(A), false);
});

test('native links do not carry target URLs and delayed confirmations recheck before opening', () => {
  const h = harness();
  h.apply([row()]);
  const site = new h.context.Site(h.lists.rows[0]);
  const serialized = JSON.stringify(site.render());
  assert.equal(serialized.includes(A), false);
  assert.equal(serialized.includes('"href":"#Open"'), true);
  site.handleOpenClick({preventDefault() {}});
  assert.deepEqual(Array.from(h.calls.find(call => call.command === 'wrapperOpenWindow').params), ['/' + A, '_top']);
  h.calls.length = 0;
  h.lists.trust['author.epix_1'].state = 'warned';
  let confirm;
  h.context.Page.cmd = (command, params, cb) => {
    h.calls.push({command, params});
    if (command === 'wrapperConfirm') confirm = cb;
  };
  site.handleOpenClick({preventDefault() {}});
  assert.equal(typeof confirm, 'function');
  h.decisions.set(A, {status: 'removed', removedKey: key(A), reasonCode: 'malware'});
  confirm();
  assert.equal(h.calls.some(call => call.command === 'wrapperOpenWindow'), false);
  assertNoTarget(site.render());
});

test('bounded records reject identifying reason fields and legacy feed emits no address', () => {
  const h = harness();
  assertNoTarget(h.context.SiteRemoval.render({removedKey: key(A), reasonCode: A, source: A, address: A}));
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'dbschema.json'), 'utf8'));
  assert.deepEqual(schema.feeds, {});
});

test('real policy adapter verifies snapshot before catalogue projection and preserves removal on failure', async () => {
  const Registry = require('../js/utils/RemovalRegistry.js');
  const Client = require('../js/utils/RemovalPolicy.js');
  const h = harness();
  const policyId = 'epix-xite-removal-v1';
  const now = 1793210400;
  const snapshot = Registry.buildSnapshot({policyId, authority: C, sequence: 1,
    issuedAt: now - 60, expiresAt: now + 3600, records: [{
      removedKey: Registry.targetKey(policyId, 'address', A), policyId, subjectKind: 'address',
      action: 'remove', reasonCode: 'malware', decisionId: 'R-1', revision: 1, authority: C
    }]});
  let corrupt = false;
  h.context.Page.cmd = (command, params, cb) => {
    if (command === 'fileGet') cb(corrupt ? '{}' : JSON.stringify(snapshot));
    else if (command === 'wrapperSetLocalStorage') cb('ok');
    else throw new Error('Unexpected bridge call: ' + command);
  };
  const client = h.context.RemovalPolicy = new Client(() => h.context.Page, {now: () => now});
  await client.configure({content: {address: C, settings: {removals: {policyId,
    snapshot: 'removals.json', checkpoint: snapshot.checkpoint}}}});
  h.apply([row(), row(B, 2, {title: 'Allowed', description: '', tags: ''})]);
  assert.equal(h.lists.rows.length, 1);
  assert.equal(h.lists.rows[0].address, B);
  assertNoTarget(h.context.SiteRemoval.render(h.lists.removals[0]));
  corrupt = true;
  await client.refresh();
  h.apply([row(), row(B, 2)]);
  assert.equal(h.lists.rows.length, 0);
  assert.equal(h.lists.removals.length, 1);
  assert.equal(h.lists.policy_unavailable, true);
});

test('startup waits for wrapper preferences before accepting the checkpoint without deadlocking', async () => {
  const Registry = require('../js/utils/RemovalRegistry.js');
  const Client = require('../js/utils/RemovalPolicy.js');
  const h = harness();
  const c = h.context;
  const now = 1793210400;
  const policyId = 'epix-xite-removal-v1';
  const snapshot = Registry.buildSnapshot({policyId, authority: C, sequence: 1,
    issuedAt: now - 60, expiresAt: now + 3600, records: []});
  let deliverStorage;
  let snapshotReads = 0;
  c.EpixFrame = class {
    constructor() { this.init(); }
    log() {}
    cmd(command, params, cb) {
      if (command === 'wrapperGetLocalStorage') deliverStorage = cb;
      else if (command === 'dbQuery') cb([]);
      else if (command === 'fileGet') { snapshotReads++; cb(JSON.stringify(snapshot)); }
      else if (command === 'wrapperSetLocalStorage') cb('ok');
      else throw new Error('Unexpected startup request: ' + command);
    }
  };
  c.maquette = {h: c.h, createProjector: () => ({replace() {}, scheduleRender() {}})};
  c.Head = class { constructor() { this.active = 'popular'; this.search_text = ''; } render() {} };
  c.$ = () => ({});
  c.base = {href: 'http://localhost/'};
  c.Text.parseQuery = () => ({url: ''});
  c.setInterval = () => 1;
  c.requestAnimationFrame = cb => cb();
  c.document.body = {classList: {add() {}, remove() {}}};
  c.RemovalPolicy = new Client(() => c.Page, {now: () => now, timeout: 1000});
  ['js/utils/Deferred.js', 'js/SiteList.js', 'js/EpixSites.js'].forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), c, {filename: file});
  });
  c.Page.setSiteInfo({address: C, auth_address: B, content: {address: C, settings: {
    languages: [], categories: [], removals: {policyId, snapshot: 'removals.json', checkpoint: snapshot.checkpoint}
  }}});
  assert.equal(typeof deliverStorage, 'function');
  assert.equal(snapshotReads, 0, 'do not read policy before rollback cache becomes available');
  deliverStorage({filter_lang: {}, custom_preference: 42});
  await c.RemovalPolicy.ready();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(snapshotReads, 1);
  assert.equal(c.RemovalPolicy.check(A).status, 'allowed');
  assert.equal(c.Page.site_lists.loaded, true);
  assert.equal(c.Page.site_lists.policy_unavailable, false);
  assert.equal(c.Page.local_storage.custom_preference, 42);
});
