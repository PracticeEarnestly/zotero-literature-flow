/* Literature Flow - AGPL-3.0-or-later. See LICENSE and NOTICE. */

var chromeHandle;
var literatureFlowContext;

function install() {}

async function startup({ rootURI }, reason) {
  const aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "zotero-literature-flow", rootURI + "content/"],
  ]);

  literatureFlowContext = { rootURI };
  literatureFlowContext._globalThis = literatureFlowContext;
  Services.scriptloader.loadSubScript(
    rootURI + "content/vendor/jszip.min.js",
    literatureFlowContext,
  );
  Services.scriptloader.loadSubScript(
    rootURI + "content/workflow.js",
    literatureFlowContext,
  );
  await literatureFlowContext.LiteratureFlow.startup();
}

async function onMainWindowLoad({ window }, reason) {
  await literatureFlowContext?.LiteratureFlow.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await literatureFlowContext?.LiteratureFlow.onMainWindowUnload(window);
}

async function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;
  await literatureFlowContext?.LiteratureFlow.shutdown();
  if (chromeHandle) chromeHandle.destruct();
  chromeHandle = null;
  literatureFlowContext = null;
}

function uninstall() {}
