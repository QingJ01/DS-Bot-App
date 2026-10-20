function releaseTarget(tag) {
  const match = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-r([1-9]\d*))?$/.exec(tag || "");
  if (!match) throw new Error("Use vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-rN");
  const version = match[1], revision = match[2] || "";
  return {
    version,
    revision,
    desktop: revision === "",
    releaseTag: `v${version}`,
    pluginFile: `ds-bot-${version}${revision ? `-r${revision}` : ""}.tgz`,
    checksumsFile: `SHA256SUMS${revision ? `-r${revision}` : ""}`,
    notesFile: `docs/releases/${tag}.md`,
  };
}
module.exports = { releaseTarget };
