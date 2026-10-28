(function() {
  "use strict";

  // Only bounded fields leave this adapter. Raw catalogue rows and report
  // notes must never become the view model for a removed entry.
  var REASONS = {
    malware: "Malware", abuse: "Abuse or exploitation of a person",
    scam: "Scam or phishing", spam: "Spam or duplicate", dead: "Dead or broken",
    policy: "Removal policy", other: "Removal policy"
  };
  var community = Object.create(null);

  function key(address) {
    try { return window.RemovalPolicy ? RemovalPolicy.key(address) : null; }
    catch (_) { return null; }
  }

  function safeRecord(decision, source) {
    var removedKey = decision && decision.removedKey;
    if (typeof removedKey !== "string" || !/^[a-f0-9]{64}$/.test(removedKey)) return null;
    return {
      removedKey: removedKey,
      reasonCode: Object.prototype.hasOwnProperty.call(REASONS, decision.reasonCode) ? decision.reasonCode : "policy",
      status: "removed", source: source === "community" ? "community" : "policy"
    };
  }

  function check(address) {
    var result;
    try { result = window.RemovalPolicy && RemovalPolicy.check(address); } catch (_) {}
    if (result && result.status === "removed") {
      return safeRecord(result, "policy") || {status: "verification_unavailable"};
    }
    var match = community[key(address)];
    if (match) return match;
    return result && result.status === "allowed" ? {status: "allowed"} : {
      status: "verification_unavailable", error: result && result.error === "unresolved_address" ? "unresolved_address" : "verification_unavailable"
    };
  }

  function message(decision) {
    if (decision && decision.status === "removed") {
      return _("This Xite was removed. Reason: {reason}.", {reason: _(REASONS[decision.reasonCode] || REASONS.policy)});
    }
    if (decision && decision.error === "unresolved_address") {
      return _("Use a canonical Xite address or wait for verified name resolution.");
    }
    return _("The removal policy could not be verified. Try again when verification is available.");
  }

  function notify(decision) {
    Page.cmd("wrapperNotification", ["info", message(decision)]);
  }

  function guard(address, cb) {
    if (!window.RemovalPolicy) return cb({status: "verification_unavailable"});
    try {
      RemovalPolicy.guard(address, function(result) {
        var decision = check(address);
        if (decision.status !== "removed" && (!result || result.status !== "allowed")) {
          decision = {status: "verification_unavailable", error: result && result.error === "unresolved_address" ? "unresolved_address" : "verification_unavailable"};
        }
        if (decision.status === "allowed" && result && result.status === "allowed" && result.canonicalAddress) {
          decision.canonicalAddress = result.canonicalAddress;
        }
        cb(decision);
      });
    } catch (_) { cb({status: "verification_unavailable"}); }
  }

  function remember(rows, trust) {
    community = Object.create(null);
    rows.forEach(function(row) {
      var info = trust[row.uri];
      if (!info || info.state !== "delisted") return;
      var reasons = ((info.evidence && info.evidence.reports) || []).map(function(report) {
        return report.reason;
      });
      var reason = ["malware", "abuse", "scam"].find(function(value) { return reasons.indexOf(value) !== -1; }) || "policy";
      var record = safeRecord({removedKey: key(row.address), reasonCode: reason}, "community");
      if (record) community[record.removedKey] = record;
    });
  }

  function records() {
    var all = Object.assign(Object.create(null), community);
    var supplied = [];
    try { supplied = window.RemovalPolicy ? RemovalPolicy.records() : []; } catch (_) {}
    if (Array.isArray(supplied)) supplied.forEach(function(entry) {
      var record = safeRecord(entry, "policy");
      if (record) all[record.removedKey] = record;
    });
    return Object.keys(all).sort().map(function(value) { return all[value]; });
  }

  function target(collection, record) {
    if (record.deleted) return null;
    if (collection === "sites") return record.address || "";
    if (collection === "claims") return record.target_address || "";
    var uri = collection === "stars" ? record.site_uri : record.target_dir + "_" + record.target_site_id;
    var rows = Page.site_lists && Page.site_lists.rows || [];
    var row = rows.find(function(value) { return value.uri === uri; });
    // Unknown targets are not permission to publish. Withdrawal tombstones
    // remain possible without resurrecting their old identifying fields.
    return row ? row.address : "";
  }

  function render(decision) {
    var record = safeRecord(decision, decision && decision.source);
    if (!record) return h("div.removal-unavailable", {role: "status"}, message(null));
    return h("article.removal-entry", {key: "removed-" + record.removedKey}, [
      h("h3", _("Removed Xite")),
      h("code.removal-key", record.removedKey),
      h("p.removal-reason", _("Reason: {reason}", {reason: _(REASONS[record.reasonCode])})),
      h("p.removal-source", record.source === "community" ? _("Delisted by community reports") : _("Removed by the adopted policy"))
    ]);
  }

  window.SiteRemoval = {key: key, check: check, guard: guard, message: message,
    notify: notify, remember: remember, records: records, render: render, target: target};
})();
