(function () {
  var poster = {
    versionNumber: 1001,
    dev:
      location.hostname === "localhost" || location.hostname === "127.0.0.1",
  };

  var eventCb = {};
  var _statueandler = null;
  var _consolehandler = null;

  function callFunc(msg, cb) {
    msg.eventID = Math.floor(Date.now() + Math.random() * 100000);
    eventCb[msg.eventID] = function (err, res) {
      if (cb) cb(err, res);
    };
    var serialized = JSON.stringify(msg);
    window.postMessage(serialized, "*");
    try {
      document.documentElement.dispatchEvent(
        new CustomEvent("dianwu-geo-bridge-request", {
          bubbles: true,
          detail: msg,
        }),
      );
    } catch (_e) {}
  }

  poster.openSyncPage = function (article, cb) {
    callFunc({ method: "openSyncPage", article: article }, cb);
  };

  poster.getAccounts = function (cb) {
    callFunc({ method: "getAccounts" }, cb);
  };

  poster.addTask = function (task, statueandler, cb) {
    _statueandler = statueandler;
    callFunc({ method: "addTask", task: task }, cb);
  };

  poster.magicCall = function (data, cb) {
    callFunc(
      {
        method: "magicCall",
        methodName: data.methodName,
        data: data,
      },
      cb,
    );
  };

  poster.uploadImage = function (data, cb) {
    callFunc(
      {
        method: "magicCall",
        methodName: "uploadImage",
        data: data,
      },
      cb,
    );
  };

  window.addEventListener("message", function (evt) {
    try {
      var action = JSON.parse(evt.data);
      if (action.method && action.method === "taskUpdate") {
        if (_statueandler != null) _statueandler(action.task);
        return;
      }

      if (action.method && action.method === "consoleLog") {
        if (_consolehandler != null) _consolehandler(action.args);
        return;
      }
      if (!action.callReturn) return;
      if (action.eventID && eventCb[action.eventID]) {
        var cb = eventCb[action.eventID];
        delete eventCb[action.eventID];
        var result = action.result;
        if (result && result.success === false) {
          cb(result.error || "failed", result);
        } else {
          cb(null, result);
        }
      }
    } catch (_e) {}
  });

  window.$poster = poster;
  window.$syncer = poster;
  window.__DWGEO_EXTENSION_INSTALLED__ = true;
})();
