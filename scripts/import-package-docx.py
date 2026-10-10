from __future__ import annotations

import argparse
import json
from pathlib import Path

from docx import Document


PACKAGE_METADATA = {
    "anti_spoiling": {
        "title": "不溺爱也不匮乏：孩子的金钱与责任课",
        "subtitle": "18章 · 金钱观、责任感与家庭边界",
        "intro": "从谈钱、零用钱和家庭账本出发，帮助孩子理解资源、欲望、责任与感恩，在温和而坚定的边界中建立健康的金钱观。",
        "gradientFrom": "#D8B58A",
        "gradientTo": "#B8895F",
    },
    "bridge": {
        "title": "幼小衔接不抢跑：从大班到一年级",
        "subtitle": "20章 · 入学准备与一年级适应",
        "intro": "把幼小衔接从提前学知识，转回心理、体能、自理、规则与学习习惯的全面准备，陪孩子平稳走过开学后的关键阶段。",
        "gradientFrom": "#9FC6D8",
        "gradientTo": "#6E9FB8",
    },
    "bullied": {
        "title": "孩子被欺负怎么办：校园欺凌应对手册",
        "subtitle": "17章 · 识别、取证、沟通与修复",
        "intro": "帮助家长区分欺凌、打闹与普通冲突，识别预警信号，掌握倾听、取证、家校沟通、升级处理和心理修复的完整路径。",
        "gradientFrom": "#D6A4A4",
        "gradientTo": "#B97070",
    },
    "emocoach": {
        "title": "做孩子的情绪教练：30堂情商课",
        "subtitle": "30章 · 共情、界限与问题解决",
        "intro": "从父母对情绪的底层态度开始，系统练习觉察、共情、命名、设限和解决问题，在不同成长阶段陪孩子发展可持续的情绪能力。",
        "gradientFrom": "#E4AA92",
        "gradientTo": "#C87F68",
    },
    "games": {
        "title": "50个家庭情绪力游戏",
        "subtitle": "50章 · 在游戏中学会表达与冷静",
        "intro": "用清单、绘画、呼吸、角色扮演和亲子互动，把抽象的情绪能力变成孩子愿意参与的家庭小游戏，随时练习觉察、表达与自我调节。",
        "gradientFrom": "#A9C9A3",
        "gradientTo": "#719D69",
    },
    "kindergarten": {
        "title": "第一次上幼儿园：择园与入园适应",
        "subtitle": "24章 · 从选园准备到家园沟通",
        "intro": "覆盖选园、报名、体检、自理训练、分离预演和入园后的常见适应问题，帮助家长和孩子更从容地迈出集体生活第一步。",
        "gradientFrom": "#9EC5BD",
        "gradientTo": "#669A90",
    },
    "motivation": {
        "title": "点燃孩子的主动性：告别催促与奖励",
        "subtitle": "18章 · 动机、成长型思维与自主感",
        "intro": "看懂怕失败、奖励依赖和家长接管如何削弱主动性，通过合适的挑战、正确归因和成长型思维，把行动的方向盘逐步还给孩子。",
        "gradientFrom": "#A8BBDD",
        "gradientTo": "#708CBF",
    },
    "pocketmoney": {
        "title": "零花钱第一课：让孩子真正学会用钱",
        "subtitle": "16章 · 零用钱、预算与消费选择",
        "intro": "从压岁钱、家务报酬和固定零用钱切入，让孩子在真实选择中学习预算、储蓄、延迟满足和明智消费。",
        "gradientFrom": "#E7C39B",
        "gradientTo": "#CE9561",
    },
    "routine": {
        "title": "告别磨蹭：孩子的时间管理课",
        "subtitle": "20章 · 时间感、惯例与自主安排",
        "intro": "理解孩子磨蹭背后的发展规律，用可视化时间、流程表和自然后果建立日常节奏，让早晨、作业、出门和睡前少一些催促。",
        "gradientFrom": "#D7AE98",
        "gradientTo": "#B98068",
    },
    "social": {
        "title": "孩子的社交课：交友、边界与冲突",
        "subtitle": "24章 · 表达、拒绝、修复与防欺凌",
        "intro": "从社交发展和先天气质出发，练习分享、轮流、坚定表达、关系边界、冲突解决与和好，让孩子既能连接他人，也能保护自己。",
        "gradientFrom": "#C4A8C8",
        "gradientTo": "#986F9F",
    },
}


def read_docx_json(path: Path) -> list[dict]:
    payload = "\n".join(paragraph.text for paragraph in Document(path).paragraphs)
    data = json.loads(payload)
    if not isinstance(data, list) or not data:
        raise ValueError(f"{path.name}: 顶层必须是非空数组")
    return data


def validate_chapters(path: Path, chapters: list[dict]) -> str:
    required = {
        "_id": str,
        "packageId": str,
        "chapterIndex": int,
        "title": str,
        "sections": list,
        "isFree": bool,
        "status": str,
        "sortOrder": int,
    }
    package_ids = {item.get("packageId") for item in chapters}
    if len(package_ids) != 1:
        raise ValueError(f"{path.name}: 必须且只能包含一个 packageId")
    package_id = next(iter(package_ids))
    if package_id not in PACKAGE_METADATA:
        raise ValueError(f"{path.name}: 未配置专题包目录信息 {package_id}")

    ids = set()
    indexes = []
    for item in chapters:
        for field, expected_type in required.items():
            if not isinstance(item.get(field), expected_type):
                raise ValueError(f"{path.name}: {item.get('_id', '?')}.{field} 类型错误")
        if item["_id"] in ids:
            raise ValueError(f"{path.name}: 重复章节 ID {item['_id']}")
        ids.add(item["_id"])
        indexes.append(item["chapterIndex"])
        if not item["sections"]:
            raise ValueError(f"{path.name}: {item['_id']} 没有小节")
        for section in item["sections"]:
            if not isinstance(section, dict):
                raise ValueError(f"{path.name}: {item['_id']} 小节格式错误")
            for field in ("heading", "content"):
                value = section.get(field)
                if not isinstance(value, str) or not value.strip():
                    raise ValueError(f"{path.name}: {item['_id']}.sections.{field} 为空")

    expected = list(range(1, len(chapters) + 1))
    if indexes != expected:
        raise ValueError(f"{path.name}: 章节编号必须按 1..{len(chapters)} 连续排列")
    return package_id


def build_catalog_item(package_id: str, chapters: list[dict], sort_order: int) -> dict:
    metadata = PACKAGE_METADATA[package_id]
    return {
        "_id": package_id,
        "title": metadata["title"],
        "subtitle": metadata["subtitle"],
        "intro": metadata["intro"],
        "icon": "",
        "price": 9.9,
        "priceFen": 990,
        "chapterCount": len(chapters),
        "sortOrder": sort_order,
        "status": "published",
        "gradientFrom": metadata["gradientFrom"],
        "gradientTo": metadata["gradientTo"],
        "chapters": [
            {
                "chapterIndex": item["chapterIndex"],
                "title": item["title"],
                "isFree": item["isFree"],
            }
            for item in chapters
        ],
    }


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="将专题包 DOCX 中的 JSON 转成独立章节分片")
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("data_dir", type=Path)
    args = parser.parse_args()

    source_files = sorted(
        path
        for path in args.source_dir.glob("id_*.docx")
        if not path.name.startswith("~$") and path.stat().st_size > 1000
    )
    if len(source_files) != len(PACKAGE_METADATA):
        raise ValueError(f"应有 {len(PACKAGE_METADATA)} 个 DOCX，实际找到 {len(source_files)} 个")

    parsed = {}
    all_chapter_ids = set()
    for source_path in source_files:
        chapters = read_docx_json(source_path)
        package_id = validate_chapters(source_path, chapters)
        if package_id in parsed:
            raise ValueError(f"专题包重复: {package_id}")
        duplicate_ids = all_chapter_ids.intersection(item["_id"] for item in chapters)
        if duplicate_ids:
            raise ValueError(f"跨文件章节 ID 重复: {sorted(duplicate_ids)}")
        all_chapter_ids.update(item["_id"] for item in chapters)
        parsed[package_id] = chapters

    missing = set(PACKAGE_METADATA) - set(parsed)
    if missing:
        raise ValueError(f"缺少专题包: {sorted(missing)}")

    catalog_path = args.data_dir / "communication_packages.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog_by_id = {item["_id"]: item for item in catalog}
    next_sort_order = max((item.get("sortOrder", 0) for item in catalog), default=0) + 1

    outputs = []
    for package_id in PACKAGE_METADATA:
        chapters = parsed[package_id]
        output_path = args.data_dir / f"communication_chapters_{package_id}.json"
        write_json(output_path, chapters)
        outputs.append(
            {
                "packageId": package_id,
                "file": output_path.name,
                "chapters": len(chapters),
                "bytes": output_path.stat().st_size,
            }
        )
        existing_sort = catalog_by_id.get(package_id, {}).get("sortOrder")
        sort_order = existing_sort if isinstance(existing_sort, int) else next_sort_order
        if not isinstance(existing_sort, int):
            next_sort_order += 1
        catalog_by_id[package_id] = build_catalog_item(package_id, chapters, sort_order)

    updated_catalog = sorted(catalog_by_id.values(), key=lambda item: item["sortOrder"])
    write_json(catalog_path, updated_catalog)
    print(json.dumps({"catalogCount": len(updated_catalog), "outputs": outputs}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
