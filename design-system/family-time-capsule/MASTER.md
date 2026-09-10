# 小美成长记 · 温暖成长手帐

## 产品与主次

小美是主角。照片、声音和家人留下的话是主要内容；出生日期与月龄来自真实档案。
成长、成长册、我的为三个常驻目的地，记录一刻是独立动作。
优先复用现有记录、原件、离线存储、媒体阅读和出版组件。

## 共享规范

Web、原生和成长册渲染器使用 `mobile/src/design/tokens.ts`。
暖白与奶油色为实底，蜜桃粉用于状态与主要操作，杏色辅助，深灰褐色正文。
深色模式使用同一组语义键的暗色板（`journalDarkColors`），原生经 `JournalThemeProvider`
（跟随系统/浅色/深色）切换，Web 经 `@media (prefers-color-scheme: dark)` 切换 `--journal-*` 变量。
系统字体，正文 16px，辅助文字至少 13px；控件至少 44px，常用按钮 48px。
软圆角、细边框、极轻阴影；照片优先，减少套卡和重复入口。
原生共享组件集中在 `mobile/src/components/ui.tsx`（Button/Chip/IconButton/Pill/
SectionHeader/ListGroup/ListRow/EmptyState），一律读取当前色板，不写死颜色。

## 玻璃与动效

仅导航、浮动记录按钮和照片工具可用液体玻璃。正文、表单、弹窗、成长册保持实底。
iOS 26+ 在运行时与编译支持检查通过后使用 expo-glass-effect 的原生 Liquid Glass。
旧 iOS 与 Android 12+ 使用 expo-blur、透色渐变和亮边；Android 使用屏幕 BlurTargetView，旧 Android 使用不透明暖白。
减少透明度即时关闭模糊，读取偏好期间也使用实底。Web 通过 CSS 能力检测和偏好媒体查询降级。
过渡 180ms；减少动态效果时关闭。录音波形取真实麦克风信号，关闭动态时保留录音状态。
Web 导航容器不加滤镜，每个悬浮表面独立采样背景，避免记录按钮受到父级 backdrop 隔离。

## 插画

首页纪念盒、成长册入口纸张相册使用 `mobile/assets/illustrations/` 下的内置 imagegen 素材
（1024px WebP），Web 静态导入同一文件。
插画仅为装饰，屏幕阅读器略过；不进入用户照片、记忆、成长册导出或备份。提示词见同目录 `PROMPTS.md`。

## 成长册

新建提供照片册、图文成长记两种模板；历史来信模板保留阅读和兼容编辑。
Web/原生预览及 PDF、EPUB、离线阅读包采用一致的纸张和文字色。
渲染版本变化必须使旧样式缓存失效；任何展示改动都不扩大原内容读者范围。

## 验证

375/768/1024/1440px、系统大字、对比度、焦点与触控区域。
必须在实际 CSP 下检查颜色与样式，不通过放宽 CSP 解决样式问题。
导入视频验证文件缺少 MIME、原始字节保存、真正的解码播放与 HEVC 兼容转码。
构建通过、自动化播放通过与真实 Android/iOS 设备验收分别记录。
