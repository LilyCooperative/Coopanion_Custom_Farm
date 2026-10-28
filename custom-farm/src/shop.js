/**
 * 价格表：内置静态数值。
 * 产物价是 `farm_crop` 的 selling_price，种子价是 `farm_seed` 的 buying/selling_price。
 * 价格为内置静态数值；改价格直接改这里。
 */
export const CROP_PRICES = {
  "tomato": {
    "sell": 70,
    "buy": 140,
    "name": "番茄"
  },
  "pumpkin": {
    "sell": 370,
    "buy": 740,
    "name": "南瓜"
  },
  "corn": {
    "sell": 115,
    "buy": 230,
    "name": "玉米"
  },
  "potato": {
    "sell": 35,
    "buy": 70,
    "name": "土豆"
  },
  "strawberry": {
    "sell": 90,
    "buy": 180,
    "name": "草莓"
  },
  "carrot": {
    "sell": 40,
    "buy": 80,
    "name": "胡萝卜"
  },
  "beetroot": { "sell": 65, "buy": 130, "name": "甜菜根" },
  "blueberry": { "sell": 95, "buy": 190, "name": "蓝莓" },
  "bok_choy": { "sell": 50, "buy": 100, "name": "小白菜" },
  "cauliflower": { "sell": 90, "buy": 180, "name": "花椰菜" },
  "cucumber": { "sell": 70, "buy": 140, "name": "黄瓜" },
  "eggplant": { "sell": 85, "buy": 170, "name": "茄子" },
  "garlic": { "sell": 45, "buy": 90, "name": "大蒜" },
  "pineapple": { "sell": 160, "buy": 320, "name": "菠萝" },
  "radish": { "sell": 35, "buy": 70, "name": "小萝卜" },
  "red_chili": { "sell": 60, "buy": 120, "name": "红辣椒" },
  "red_onion": { "sell": 65, "buy": 130, "name": "红洋葱" },
  "watermelon": { "sell": 220, "buy": 440, "name": "西瓜" }
};

/**
 * 种子：种植一棵消耗 1 包对应种子；买来的种子先进背包（inventory[seed_id]）。
 * 种子与作物一一对应；作物数量见 crops.js。
 */
export const SEEDS = [
  { crop: 'potato', id: 'seed_potato', buy: 30, sell: 6 },
  { crop: 'tomato', id: 'seed_tomato', buy: 120, sell: 24 },
  { crop: 'strawberry', id: 'seed_strawberry', buy: 150, sell: 30 },
  { crop: 'corn', id: 'seed_corn', buy: 55, sell: 11 },
  { crop: 'pumpkin', id: 'seed_pumpkin', buy: 100, sell: 20 },
  { crop: 'carrot', id: 'seed_carrot', buy: 20, sell: 4 },
  { crop: 'beetroot', id: 'seed_beetroot', buy: 40, sell: 8 },
  { crop: 'blueberry', id: 'seed_blueberry', buy: 70, sell: 14 },
  { crop: 'bok_choy', id: 'seed_bok_choy', buy: 25, sell: 5 },
  { crop: 'cauliflower', id: 'seed_cauliflower', buy: 55, sell: 11 },
  { crop: 'cucumber', id: 'seed_cucumber', buy: 45, sell: 9 },
  { crop: 'eggplant', id: 'seed_eggplant', buy: 50, sell: 10 },
  { crop: 'garlic', id: 'seed_garlic', buy: 25, sell: 5 },
  { crop: 'pineapple', id: 'seed_pineapple', buy: 90, sell: 18 },
  { crop: 'radish', id: 'seed_radish', buy: 20, sell: 4 },
  { crop: 'red_chili', id: 'seed_red_chili', buy: 35, sell: 7 },
  { crop: 'red_onion', id: 'seed_red_onion', buy: 40, sell: 8 },
  { crop: 'watermelon', id: 'seed_watermelon', buy: 120, sell: 24 },
].map((s) => ({ ...s, name: (CROP_PRICES[s.crop]?.name ?? s.crop) + '种子' }));

export const SEED_BY_CROP = Object.fromEntries(SEEDS.map((s) => [s.crop, s]));
export const SEED_BY_ID = Object.fromEntries(SEEDS.map((s) => [s.id, s]));

/** 作物 -> 它的种子 item id（游戏里就是 seed_<crop>）。 */
export function seedItemOf(cropKey) {
  return SEED_BY_CROP[cropKey]?.id ?? 'seed_' + cropKey;
}

import { live } from './catalog-state.js';

/** 背包里某个 item id 的出售价（道具自定义里 sell>0 才算能卖；0 = 不能卖）。 */
export function sellPriceOf(itemId) {
  const item = live.items?.[itemId];
  if (item) return item.sell > 0 ? item.sell : 0;
  return Number(SEED_BY_ID[itemId]?.sell ?? CROP_PRICES[itemId]?.sell ?? 0);
}

/** 背包里某个 item id 的买价（道具自定义里 buy>0 才卖；0 = 商店不卖）。 */
export function buyPriceOf(itemId) {
  const item = live.items?.[itemId];
  if (item) return item.buy > 0 ? item.buy : 0;
  return Number(SEED_BY_ID[itemId]?.buy ?? SEED_BY_CROP[itemId]?.buy ?? FURNITURE_BY_ID[itemId]?.buy ?? 0);
}


/**
 * 家具总开关：2026-10-27 起暂时下架（摆放方案还没定）。
 * false = 商店不列、farm_buy 不卖家具、farm_place 报错；存档里已经有的家具保留不删。
 * 恢复：改回 true。
 */
export const FURNITURE_ENABLED = false;

/** 商店里的家具（装饰 / 灯 / 花盆），买价卖价都是游戏里的数。 */
export const FURNITURE = [
  {
    "id": "plantbasin_wooden",
    "name": "木制种植盆",
    "sprite": "icon_item_plantbasin_wooden",
    "buy": 50,
    "sell": -1,
    "sub": "equipment_plantbasin"
  },
  {
    "id": "plantbasin_eggshell",
    "name": "蛋壳种植盆",
    "sprite": "icon_item_plantbasin_eggshell",
    "buy": 150,
    "sell": -1,
    "sub": "equipment_plantbasin"
  },
  {
    "id": "plantbasin_mountain",
    "name": "山峦种植盆",
    "sprite": "icon_item_plantbasin_mountain",
    "buy": 150,
    "sell": -1,
    "sub": "equipment_plantbasin"
  },
  {
    "id": "plantbasin_shrub_plain",
    "name": "平原灌木基盆",
    "sprite": "icon_item_plantbasin_shrub_plain",
    "buy": 150,
    "sell": -1,
    "sub": "equipment_plantbasin"
  },
  {
    "id": "porcelain_vat",
    "name": "藤蔓瓷缸",
    "sprite": "icon_item_porcelain_vat",
    "buy": 500,
    "sell": 250,
    "sub": "equipment_plantbasin"
  },
  {
    "id": "nature_light",
    "name": "原木灯",
    "sprite": "icon_item_nature_light",
    "buy": 500,
    "sell": -1,
    "sub": "equipment_lamps"
  },
  {
    "id": "electric_torch",
    "name": "电火炬",
    "sprite": "icon_item_electric_torch",
    "buy": 1750,
    "sell": -1,
    "sub": "equipment_lamps"
  },
  {
    "id": "palm_floor_lamp",
    "name": "棕榈落地灯",
    "sprite": "icon_item_palm_floor_lamp",
    "buy": 2250,
    "sell": -1,
    "sub": "equipment_lamps"
  },
  {
    "id": "mountain_floor_lamp",
    "name": "山峦落地灯",
    "sprite": "icon_item_mountain_floor_lamp",
    "buy": 410,
    "sell": -1,
    "sub": "equipment_lamps"
  },
  {
    "id": "copper_floor_lamp",
    "name": "铜制落地灯",
    "sprite": "icon_item_copper_floor_lamp",
    "buy": 240,
    "sell": -1,
    "sub": "equipment_lamps"
  },
  {
    "id": "horned_floor_lamp",
    "name": "草原旋角落地灯",
    "sprite": "icon_item_horned_floor_lamp",
    "buy": 1540,
    "sell": -1,
    "sub": "equipment_lamps"
  },
  {
    "id": "plain_floor_lamp",
    "name": "平原落地灯",
    "sprite": "icon_item_plain_floor_lamp",
    "buy": 460,
    "sell": -1,
    "sub": "equipment_lamps"
  },
  {
    "id": "sunmao_lamp_stand",
    "name": "榫卯灯架",
    "sprite": "icon_item_sunmao_lamp_stand",
    "buy": 980,
    "sell": -1,
    "sub": "equipment_lamps"
  },
  {
    "id": "nature_table",
    "name": "原木桌",
    "sprite": "icon_item_nature_table",
    "buy": 400,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "nature_chair",
    "name": "原木椅",
    "sprite": "icon_item_nature_chair",
    "buy": 280,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "nature_sofa",
    "name": "原木沙发",
    "sprite": "icon_item_nature_sofa",
    "buy": 720,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "nature_shelf",
    "name": "原木置物架",
    "sprite": "icon_item_nature_shelf",
    "buy": 880,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "islands_chair",
    "name": "岛屿椅",
    "sprite": "icon_item_islands_chair",
    "buy": 500,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "mountain_chair",
    "name": "山峦椅子",
    "sprite": "icon_item_mountain_chair",
    "buy": 540,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "mountain_table",
    "name": "山峦桌子",
    "sprite": "icon_item_mountain_table",
    "buy": 690,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "copper_sofa",
    "name": "铜制沙发",
    "sprite": "icon_item_copper_sofa",
    "buy": 680,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "copper_armchair",
    "name": "铜制扶手椅",
    "sprite": "icon_item_copper_armchair",
    "buy": 340,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "copper_coffee_table",
    "name": "铜制茶几",
    "sprite": "icon_item_copper_coffee_table",
    "buy": 220,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "copper_cabinet",
    "name": "铜制柜子",
    "sprite": "icon_item_copper_cabinet",
    "buy": 680,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "copper_low_cabinet",
    "name": "铜制矮柜",
    "sprite": "icon_item_copper_low_cabinet",
    "buy": 220,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "grassland_armchair",
    "name": "草原靠背椅",
    "sprite": "icon_item_grassland_armchair",
    "buy": 1600,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "grassland_dressing_table",
    "name": "草原镜台",
    "sprite": "icon_item_grassland_dressing_table",
    "buy": 1600,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "grassland_low_table",
    "name": "草原矮桌",
    "sprite": "icon_item_grassland_low_table",
    "buy": 1700,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "grassland_hu_chair",
    "name": "草原胡椅",
    "sprite": "icon_item_grassland_hu_chair",
    "buy": 1500,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "plain_long_table",
    "name": "平原长桌",
    "sprite": "icon_item_plain_long_table",
    "buy": 890,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "plain_low_stool",
    "name": "平原矮凳",
    "sprite": "icon_item_plain_low_stool",
    "buy": 360,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "plain_armchair",
    "name": "平原靠背椅",
    "sprite": "icon_item_plain_armchair",
    "buy": 850,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "sunmao_table",
    "name": "榫卯翘头案",
    "sprite": "icon_item_sunmao_table",
    "buy": 1600,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "sunmao_chair",
    "name": "榫卯官帽椅",
    "sprite": "icon_item_sunmao_chair",
    "buy": 980,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "sunmao_tree",
    "name": "榫卯盆景树",
    "sprite": "icon_item_sunmao_tree",
    "buy": 2500,
    "sell": 1250,
    "sub": "equipment_ornament"
  },
  {
    "id": "scarecrow",
    "name": "稻草人",
    "sprite": "icon_item_scarecrow",
    "buy": 250,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "terrarium",
    "name": "优质草缸",
    "sprite": "icon_item_terrarium",
    "buy": 1000,
    "sell": -1,
    "sub": "equipment_ornament"
  },
  {
    "id": "kasia_artificial_flower_2",
    "name": "纸板小花",
    "sprite": "icon_item_kasia_artificial_flower_2",
    "buy": 50,
    "sell": 25,
    "sub": "equipment_ornament"
  },
  {
    "id": "kasia_artificial_flower_3",
    "name": "金属长茎花",
    "sprite": "icon_item_kasia_artificial_flower_3",
    "buy": 50,
    "sell": 25,
    "sub": "equipment_ornament"
  },
  {
    "id": "kasia_artificial_flower_4",
    "name": "金属矮花",
    "sprite": "icon_item_kasia_artificial_flower_4",
    "buy": 50,
    "sell": 25,
    "sub": "equipment_ornament"
  },
  {
    "id": "kasia_artificial_flower_5",
    "name": "塑料小花",
    "sprite": "icon_item_kasia_artificial_flower_5",
    "buy": 50,
    "sell": 25,
    "sub": "equipment_ornament"
  },
  {
    "id": "kasia_artificial_flower_6",
    "name": "塑料花茎",
    "sprite": "icon_item_kasia_artificial_flower_6",
    "buy": 50,
    "sell": 25,
    "sub": "equipment_ornament"
  }
];

export const FURNITURE_BY_ID = Object.fromEntries(FURNITURE.map((f) => [f.id, f]));
