/* SPDX-License-Identifier: AGPL-3.0-or-later */
var chromeHandle, lfScope;
function install() {}
function uninstall() {}
async function startup({rootURI}) {
  await Zotero.initializationPromise;
  Components.utils.importGlobalProperties(['fetch', 'TextEncoder', 'AbortController']);
  chromeHandle = Components.classes['@mozilla.org/addons/addon-manager-startup;1']
    .getService(Components.interfaces.amIAddonManagerStartup)
    .registerChrome(Services.io.newURI(rootURI + 'manifest.json'), [['content','zotero-literature-flow',rootURI+'content/']]);
  lfScope={Zotero,Services,ChromeUtils,Components,IOUtils,PathUtils,fetch,TextEncoder,AbortController,setTimeout,clearTimeout,rootURI};
  try {
    for(const file of ['core.js','workflow.js']) Services.scriptloader.loadSubScript(rootURI+'content/'+file,lfScope);
    await lfScope.LiteratureFlow.startup();
  } catch(e) {await shutdown();throw e;}
}
async function shutdown() {
  await lfScope?.LiteratureFlow?.shutdown();
  chromeHandle?.destruct();chromeHandle=null;lfScope=null;
}
