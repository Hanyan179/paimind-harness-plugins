# Single home brand slogan

Branding is the sole owner of the configurable name, logos, tab identity and localized homepage slogan. Removed the Visual Experience fixed hero copy and its overlay registration; the visual package continues to own theme/layout. Existing native persisted branding fields remain unchanged. The branding slogan has the sole level-one heading and responsive typography.

Validation: 29 focused tests passed; full TypeScript declaration build and package build passed. Live in-app browser at localhost:3080 loaded successfully. New-conversation homepage showed one `data-hansen-brand-hero-headline`, zero `data-paimind-experience-title` or `data-paimind-experience-eyebrow`, and the saved default slogan. Screenshot inspected in the task transcript. User branding values were not modified.

## 全系统品牌配置补齐

- 覆盖与所有权清单见 `docs/plans/brand-configuration-coverage.md`。
- 增加独立浏览器标题、安装应用简称、浅/深色首页背景、浅/深色品牌主色；原有名称、标志与中英文欢迎语继续沿用同一原生设置。
- 启动页名称及标志读取服务器品牌设置，错误详情不被覆盖。应用图标加入清单，并使用绝对资源地址。
- 定向品牌/兼容/视觉测试：21 文件、105 项通过；最后应用清单地址修正后，品牌 14 项再次通过。
- 完整构建（含类型声明）、框架门禁、42 包接口快照与真实宿主组合安装/启动/卸载/恢复检查通过。上游依赖仍有已知缺失源映射警告，不影响通过。
- 浏览器实测 `http://localhost:3080/`：设置显示四组配置；临时标题“品牌验收”保存后立即显示，刷新仍保留；主色 `#245B87` 保存、刷新均生效，应用内切换深色后使用 `#AABBCC`。
- 已恢复临时标题、两项颜色以及原浅色模式。最后回读标题 `Hansen`、主色 `#4f83b8`、唯一首页标题“从一个想法开始”，启动遮罩已消失；页面留在品牌设置供用户查看。
- 浏览器未执行安装到桌面；仅验证应用清单生成与配置输出。已安装应用的名称更新时机由浏览器决定。
- 本轮为本地实现与验收，未发布。未改动宿主源码、用户会话或智能体内容。

## 品牌设置界面整理

- 改为品牌标识、首页表达、浏览器与应用、视觉风格四个分类切换，避免纵向堆叠全部字段。
- 首页中英文标语在同一卡片并排展示，窄屏自动单列；深色覆盖项默认折叠。
- 保持配置字段、持久化与逐项保存逻辑不变。
- 品牌 14 项测试、完整构建与框架检查通过；在实际浏览器中切换到首页表达并查看截图，确认双列卡片、分类选中状态和内容层级正常。

## 自动保存交互

- 删除逐项保存与恢复默认；停止输入 500 毫秒、离开字段或卸载设置时提交，图片读取后自动提交。上传图片提供移除操作。
- 允许空值：品牌名称空值展示默认身份，标语空值隐藏，其他空项沿用默认外观。
- 15 项品牌测试、构建、框架与接口快照通过。浏览器实测修改标语自动生效，输入空白后直接关闭再打开，持久化值为空且首页标语隐藏；已自动恢复原标语“从一个想法开始”。
- 页面内仅保留分类导航，未出现保存或恢复默认按钮。
