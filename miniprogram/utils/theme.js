const AGE_GROUP_META = [
  {
    ageGroup: "3-6",
    label: "3-6 岁",
    subtitle: "幼儿期",
    tone: "coral",
    color: "#E0A998",
    borderColor: "#C4956A",
    lightColor: "#FFF0E9",
    mark: "S",
    icon: "☺",
    totalLabel: "120 个话题",
  },
  {
    ageGroup: "7-9",
    label: "7-9 岁",
    subtitle: "学龄期",
    tone: "blue",
    color: "#9AB8D6",
    borderColor: "#79ACD6",
    lightColor: "#EAF4FF",
    mark: "L",
    icon: "⊙",
    totalLabel: "100 个话题",
  },
  {
    ageGroup: "10-12",
    label: "10-12 岁",
    subtitle: "青春期前",
    tone: "purple",
    color: "#B8A0D0",
    borderColor: "#986FC9",
    lightColor: "#F1E9FF",
    mark: "R",
    icon: "☆",
    totalLabel: "80 个话题",
  },
];

function getAgeMeta(ageGroup) {
  return AGE_GROUP_META.find((item) => item.ageGroup === ageGroup) || AGE_GROUP_META[0];
}

function getGradientStyle(fromColor, toColor, deg) {
  return `linear-gradient(${deg || 155}deg, ${fromColor}, ${toColor})`;
}

module.exports = {
  AGE_GROUP_META,
  getAgeMeta,
  getGradientStyle,
};
