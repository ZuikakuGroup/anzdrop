"""Create a reproducible tar of the files actually handed to Wrangler."""

from pathlib import Path
import sys
import tarfile


def main() -> None:
    source = Path(sys.argv[1]).resolve()
    target = Path(sys.argv[2]).resolve()
    with tarfile.open(target, "w", format=tarfile.PAX_FORMAT) as archive:
        for item in sorted(source.rglob("*"), key=lambda entry: entry.relative_to(source).as_posix()):
            relative = item.relative_to(source)
            # Wrangler adds a timestamped README to --outdir. It is not an
            # upload input and would make identical bundles hash differently.
            if len(relative.parts) == 3 and relative.parts[0] == "compiled" and relative.name == "README.md":
                continue
            if item.is_symlink():
                raise ValueError(f"Symlink in deployment payload: {relative}")
            if not item.is_file() and not item.is_dir():
                raise ValueError(f"Unsupported deployment payload entry: {relative}")
            info = archive.gettarinfo(str(item), arcname=relative.as_posix())
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ""
            info.mode = 0o755 if item.is_dir() else 0o644
            info.pax_headers = {}
            if item.is_file():
                with item.open("rb") as contents:
                    archive.addfile(info, contents)
            else:
                archive.addfile(info)


if __name__ == "__main__":
    main()
