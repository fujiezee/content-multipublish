/**
 * MV3 service workers re-run onInstalled / wake often. Creating the same
 * contextMenus id again throws Unchecked runtime.lastError.
 * Make create() remove-then-create so reloads stay quiet.
 */
(function patchContextMenus() {
  const api = chrome.contextMenus;
  if (!api?.create || api.create.__dwgeoIdempotent) return;

  const origCreate = api.create.bind(api);
  const origRemove = api.remove.bind(api);

  function ignoreLastError() {
    void chrome.runtime.lastError;
  }

  api.create = function dwgeoContextMenusCreate(createProperties, callback) {
    const id = createProperties && createProperties.id;
    if (!id) {
      return origCreate(createProperties, callback);
    }
    origRemove(id, () => {
      ignoreLastError();
      origCreate(createProperties, () => {
        ignoreLastError();
        if (typeof callback === "function") callback();
      });
    });
  };
  api.create.__dwgeoIdempotent = true;
})();
