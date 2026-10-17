"""Restore the original archive without discarding the later republication."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "QingJ01/DS-Bot-App"
TAG = "v0.1.0"
PLUGIN = "ds-bot-0.1.0.tgz"
ARCHIVED = "ds-bot-0.1.0-republished.tgz"
HISTORICAL = "SHA256SUMS-before-integrity-repair"
ORIGINAL_SHA512 = "8506Zru5bpYfGgJH0QG8eD//e1Y66giA5Pak6Jm2Cdr9hqU5XjqppakzcSnkvlhpvJaiRuP2Zd2F0pK3bMr2uQ=="
ORIGINAL_SHA256 = "986a8338ba1dff47ae3a2e16e807823e4d7ce0c1553c1cdfd179da8d2bbe79c0"
REPUBLISHED_SHA256 = "68517caca1b144b134db84d4630661979d35ec309ccd278ef5a7de29fd4905a1"
OTHER_FILES = {"DeepSeekBot.cer", "dsbot-android-arm64-v0.1.0.apk", "dsbot-android-x86_64-v0.1.0.apk"}


def validate_original(data):
    if hashlib.sha256(data).hexdigest() != ORIGINAL_SHA256 or base64.b64encode(hashlib.sha512(data).digest()).decode() != ORIGINAL_SHA512:
        raise ValueError("The recovery archive differs from the original locked release")


def restored_checksums(text):
    if isinstance(text, bytes):
        text = text.decode("ascii")
    records = {}
    for line in text.splitlines():
        digest, name = line.split(maxsplit=1)
        if name in records or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("Invalid historical checksum manifest")
        records[name] = digest
    if set(records) != OTHER_FILES | {PLUGIN} or records[PLUGIN] != REPUBLISHED_SHA256:
        raise ValueError("Unexpected historical release; do not modify it")
    records[PLUGIN] = ORIGINAL_SHA256
    records[ARCHIVED] = REPUBLISHED_SHA256
    return "".join(f"{digest}  {name}\n" for name, digest in records.items()).encode()


class Github:
    def run(self, *args, data=None):
        result = subprocess.run(["gh", *args], input=data, capture_output=True, check=True)
        return result.stdout

    def api(self, endpoint, data=None):
        args = ["api", f"repos/{REPOSITORY}/{endpoint}"]
        if data is not None:
            args += ["--method", "PATCH", "--input", "-"]
        return json.loads(self.run(*args, data=None if data is None else json.dumps(data).encode()))

    def release(self, tag=TAG):
        return self.api("releases/tags/" + tag)

    def assets(self):
        return {item["name"]: item for item in self.release()["assets"]}

    def download(self, name):
        with tempfile.TemporaryDirectory(prefix="dsbot-release-read-") as directory:
            self.run("release", "download", TAG, "--repo", REPOSITORY, "--pattern", name, "--dir", directory)
            return (Path(directory) / name).read_bytes()

    def ensure_asset(self, name, data):
        item = self.assets().get(name)
        if item is None:
            with tempfile.TemporaryDirectory(prefix="dsbot-release-upload-") as directory:
                path = Path(directory) / name
                path.write_bytes(data)
                self.run("release", "upload", TAG, str(path), "--repo", REPOSITORY)
            item = self.assets()[name]
        if self.download(name) != data:
            raise ValueError("Existing recovery asset differs; refusing to overwrite " + name)
        return item

    def rename(self, item, name):
        return self.api("releases/assets/" + str(item["id"]), {"name": name})


def restore(github):
    original = (ROOT / "releases/legacy" / PLUGIN).read_bytes()
    validate_original(original)
    before = github.release()
    tag = github.api("git/ref/tags/" + TAG)["object"]
    assets = github.assets()
    historical = HISTORICAL if HISTORICAL in assets else "SHA256SUMS"
    manifest = restored_checksums(github.download(historical))
    current = github.download(PLUGIN) if PLUGIN in assets else None
    if current is not None and hashlib.sha256(current).hexdigest() not in {ORIGINAL_SHA256, REPUBLISHED_SHA256}:
        raise ValueError("Unexpected public plugin; refusing to replace it")
    if current == original and ARCHIVED not in assets:
        raise ValueError("Original archive restored without preserving the republication")
    staged = github.ensure_asset("ds-bot-0.1.0-original.tgz", original) if current != original else None
    checksum_stage = github.ensure_asset("SHA256SUMS-restored", manifest) if github.assets().get("SHA256SUMS") is None or github.download("SHA256SUMS") != manifest else None
    if ARCHIVED not in github.assets():
        if current is None:
            raise ValueError("No republished archive to preserve")
        github.rename(assets[PLUGIN], ARCHIVED)
    if hashlib.sha256(github.download(ARCHIVED)).hexdigest() != REPUBLISHED_SHA256:
        raise ValueError("Archived republication differs from the known package")
    if staged is not None:
        github.rename(staged, PLUGIN)
    if HISTORICAL not in github.assets():
        github.rename(assets["SHA256SUMS"], HISTORICAL)
    if checksum_stage is not None:
        github.rename(checksum_stage, "SHA256SUMS")
    notice = (ROOT / "docs/releases/integrity-repair-20261014.md").read_text(encoding="utf-8")
    if not before["body"].startswith(notice):
        github.api("releases/" + str(before["id"]), {"body": notice + "Historical release notes:\n\n" + before["body"]})
    assert github.download(PLUGIN) == original
    assert github.download("SHA256SUMS") == manifest
    assert github.api("git/ref/tags/" + TAG)["object"] == tag
    after = github.assets()
    for item in before["assets"]:
        if item["name"] in OTHER_FILES:
            assert after[item["name"]] == item
    print("Original public URL and locked integrity restored; later package/manifest preserved; APKs, certificate and source tag unchanged.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Restore the public release using repository write permissions")
    args = parser.parse_args()
    validate_original((ROOT / "releases/legacy" / PLUGIN).read_bytes())
    if args.apply:
        restore(Github())
    else:
        print("Original archive SHA-256 and locked SHA-512 verified. No release changes made.")


if __name__ == "__main__":
    main()
