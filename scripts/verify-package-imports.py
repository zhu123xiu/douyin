from __future__ import annotations

import json
from pathlib import Path

from docx import Document


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "cloudfunctions" / "importData"
DATA_DIR = SOURCE_DIR / "data"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_docx_json(path: Path):
    return json.loads("\n".join(paragraph.text for paragraph in Document(path).paragraphs))


def main() -> None:
    catalog = load_json(DATA_DIR / "communication_packages.json")
    catalog_by_id = {item["_id"]: item for item in catalog}
    base_chapters = load_json(DATA_DIR / "communication_chapters.json")
    seen_ids = {item["_id"] for item in base_chapters}
    results = []

    source_files = sorted(
        path
        for path in SOURCE_DIR.glob("id_*.docx")
        if not path.name.startswith("~$") and path.stat().st_size > 1000
    )
    for source_path in source_files:
        original = load_docx_json(source_path)
        package_id = original[0]["packageId"]
        output_path = DATA_DIR / f"communication_chapters_{package_id}.json"
        output = load_json(output_path)
        assert output == original, f"{package_id}: 导出内容与 Word 不一致"
        assert all(
            item["_id"] == f"{package_id}_ch{item['chapterIndex']:02d}"
            for item in output
        ), f"{package_id}: 章节 ID 不符合读取规则"

        output_ids = {item["_id"] for item in output}
        assert not seen_ids.intersection(output_ids), f"{package_id}: 章节 ID 重复"
        seen_ids.update(output_ids)

        package = catalog_by_id[package_id]
        expected_catalog = [
            {
                "chapterIndex": item["chapterIndex"],
                "title": item["title"],
                "isFree": item["isFree"],
            }
            for item in output
        ]
        assert package["chapterCount"] == len(output), f"{package_id}: 目录章数不一致"
        assert package["chapters"] == expected_catalog, f"{package_id}: 章节目录不一致"
        results.append(
            {
                "packageId": package_id,
                "chapters": len(output),
                "sizeKB": round(output_path.stat().st_size / 1024, 1),
            }
        )

    assert len(results) == 10, "专题包文件数不是 10"
    assert len(catalog) == 13, "专题包目录应为原有 3 个加新增 10 个"
    assert len(seen_ids) == 321, "总章节数不正确"
    assert len(seen_ids) == len(base_chapters) + sum(item["chapters"] for item in results)
    print(
        json.dumps(
            {
                "catalogPackages": len(catalog),
                "existingChapters": len(base_chapters),
                "newChapters": sum(item["chapters"] for item in results),
                "totalChapters": len(seen_ids),
                "files": results,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
