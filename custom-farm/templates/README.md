# 内置模板：田园农场

`tianye-farm.zip` 是按当前内置素材和默认设置生成的完整模板。

包含：

- `custom.json`：作物、杂草、装饰、动物、道具、状态、天气等默认设置
- `world.json`：可移植的玩法参数
- `env-prompt.md`：当前环境提示词
- `sprites/*.png`：模板引用的全部贴图，包括六帧鸡、木篱笆、作物/杂草/图标等

重新生成：

```powershell
node tools/build-default-template.mjs
```

导入方式：游戏配置 → 设置模板 → 导入模板 ZIP。
