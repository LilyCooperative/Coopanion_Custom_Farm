/**
 * 作物表：内置静态数据（生长点 = 各阶段 growth_value 累加、
 * repeat_level = 收完退回第几级、lifespan = 一共能收几次）。
 * 贴图帧数与 spriteW 来自当前素材（FarmCrops 16x16，帧 16x32）。
 */
export const CROPS = {
  potato: {
    key: "potato", name: "土豆", prefix: "sprite_seed_potato", icon: "icon_item_potato",
    frames: 5, spriteW: 16, total: 1440, levels: 5, repeatLevel: 4, lifespan: 1, swing: true,
    minCount: 2, maxCount: 4, items: ["potato"],
  },
  carrot: {
    key: "carrot", name: "胡萝卜", prefix: "sprite_seed_carrot", icon: "icon_item_carrot",
    frames: 5, spriteW: 16, total: 1440, levels: 5, repeatLevel: 4, lifespan: 1, swing: true,
    minCount: 1, maxCount: 3, items: ["carrot"],
  },
  tomato: {
    key: "tomato", name: "番茄", prefix: "sprite_seed_tomato", icon: "icon_item_tomato",
    frames: 6, spriteW: 16, total: 2016, levels: 6, repeatLevel: 4, lifespan: 4, swing: true,
    minCount: 2, maxCount: 4, items: ["tomato"],
  },
  strawberry: {
    key: "strawberry", name: "草莓", prefix: "sprite_seed_strawberry", icon: "icon_item_strawberry",
    frames: 6, spriteW: 16, total: 2304, levels: 6, repeatLevel: 4, lifespan: 5, swing: true,
    minCount: 2, maxCount: 4, items: ["strawberry"],
  },
  corn: {
    key: "corn", name: "玉米", prefix: "sprite_seed_corn", icon: "icon_item_corn",
    frames: 6, spriteW: 16, total: 2304, levels: 6, repeatLevel: 5, lifespan: 1, swing: true,
    minCount: 2, maxCount: 2, items: ["corn"],
  },
  pumpkin: {
    key: "pumpkin", name: "南瓜", prefix: "sprite_seed_pumpkin", icon: "icon_item_pumpkin",
    frames: 6, spriteW: 16, total: 2592, levels: 6, repeatLevel: 5, lifespan: 1, swing: true,
    minCount: 1, maxCount: 1, items: ["pumpkin"],
  },
  beetroot: {
    key: "beetroot", name: "甜菜根", prefix: "sprite_seed_beetroot", icon: "icon_item_beetroot",
    frames: 5, spriteW: 16, total: 1728, levels: 5, repeatLevel: 4, lifespan: 1, swing: true,
    minCount: 1, maxCount: 2, items: ["beetroot"],
  },
  blueberry: {
    key: "blueberry", name: "蓝莓", prefix: "sprite_seed_blueberry", icon: "icon_item_blueberry",
    frames: 6, spriteW: 16, total: 2592, levels: 6, repeatLevel: 4, lifespan: 3, swing: true,
    minCount: 2, maxCount: 4, items: ["blueberry"],
  },
  bok_choy: {
    key: "bok_choy", name: "小白菜", prefix: "sprite_seed_bok_choy", icon: "icon_item_bok_choy",
    frames: 5, spriteW: 16, total: 1152, levels: 5, repeatLevel: 4, lifespan: 1, swing: true,
    minCount: 1, maxCount: 2, items: ["bok_choy"],
  },
  cauliflower: {
    key: "cauliflower", name: "花椰菜", prefix: "sprite_seed_cauliflower", icon: "icon_item_cauliflower",
    frames: 5, spriteW: 16, total: 1728, levels: 5, repeatLevel: 4, lifespan: 1, swing: true,
    minCount: 1, maxCount: 1, items: ["cauliflower"],
  },
  cucumber: {
    key: "cucumber", name: "黄瓜", prefix: "sprite_seed_cucumber", icon: "icon_item_cucumber",
    frames: 6, spriteW: 16, total: 2016, levels: 6, repeatLevel: 4, lifespan: 3, swing: true,
    minCount: 1, maxCount: 3, items: ["cucumber"],
  },
  eggplant: {
    key: "eggplant", name: "茄子", prefix: "sprite_seed_eggplant", icon: "icon_item_eggplant",
    frames: 6, spriteW: 16, total: 2304, levels: 6, repeatLevel: 4, lifespan: 3, swing: true,
    minCount: 1, maxCount: 2, items: ["eggplant"],
  },
  garlic: {
    key: "garlic", name: "大蒜", prefix: "sprite_seed_garlic", icon: "icon_item_garlic",
    frames: 4, spriteW: 16, total: 1440, levels: 4, repeatLevel: 4, lifespan: 1, swing: true,
    minCount: 1, maxCount: 2, items: ["garlic"],
  },
  pineapple: {
    key: "pineapple", name: "菠萝", prefix: "sprite_seed_pineapple", icon: "icon_item_pineapple",
    frames: 6, spriteW: 16, total: 2880, levels: 6, repeatLevel: 4, lifespan: 1, swing: true,
    minCount: 1, maxCount: 1, items: ["pineapple"],
  },
  radish: {
    key: "radish", name: "小萝卜", prefix: "sprite_seed_radish", icon: "icon_item_radish",
    frames: 5, spriteW: 16, total: 1152, levels: 5, repeatLevel: 4, lifespan: 1, swing: true,
    minCount: 1, maxCount: 2, items: ["radish"],
  },
  red_chili: {
    key: "red_chili", name: "红辣椒", prefix: "sprite_seed_red_chili", icon: "icon_item_red_chili",
    frames: 6, spriteW: 16, total: 1728, levels: 6, repeatLevel: 4, lifespan: 4, swing: true,
    minCount: 2, maxCount: 3, items: ["red_chili"],
  },
  red_onion: {
    key: "red_onion", name: "红洋葱", prefix: "sprite_seed_red_onion", icon: "icon_item_red_onion",
    frames: 4, spriteW: 16, total: 1728, levels: 4, repeatLevel: 4, lifespan: 1, swing: true,
    minCount: 1, maxCount: 2, items: ["red_onion"],
  },
  watermelon: {
    key: "watermelon", name: "西瓜", prefix: "sprite_seed_watermelon", icon: "icon_item_watermelon",
    frames: 6, spriteW: 16, total: 2880, levels: 6, repeatLevel: 4, lifespan: 1, swing: true,
    minCount: 1, maxCount: 1, items: ["watermelon"],
  },
};

/** 前 4 个正好对应 STARTER_SEEDS；其余按生长速度排在后面。 */
export const ROTATION = [
  "potato", "carrot", "tomato", "strawberry", "corn", "pumpkin",
  "bok_choy", "radish", "beetroot", "garlic", "cauliflower", "red_onion",
  "cucumber", "red_chili", "blueberry", "eggplant", "pineapple", "watermelon",
];
