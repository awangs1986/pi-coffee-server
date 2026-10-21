# MISHU 长期秘书体验：规格已迁移

产品规格与功能主票由独立 [pi-coffee-mishu](http://gitea/awangs/pi-coffee-mishu) 仓库维护。

- [完整体验规格 E01–E05 / A36–A45](http://gitea/awangs/pi-coffee-mishu/src/branch/main/docs/secretary-experience.md)
- [完整秘书规格](http://gitea/awangs/pi-coffee-mishu/src/branch/main/docs/coffee-secretary-spec.md)
- [源码职责](http://gitea/awangs/pi-coffee-mishu/src/branch/main/docs/source-ownership.md)
- [功能主票](http://gitea/awangs/pi-coffee-mishu/issues)

此文件保留旧链接。Server 仍拥有认证 scope、Host 执行/持久账本、原生 Agent Adapter 和网页集成，
通过不可变 MISHU 包消费纯产品策略；不能在这里重新维护第二份角色、模板或产品规格。
2026-10-21 的 #7–#15 实现候选在 `feat/mishu-secretary-experience`；[Host 资源合同](mishu.md)与[验收方式](../development/mishu-experience.md)记录集成。最终通过、不可变包与生产分别记录，不因源码存在推断上线。当前秘书源由 Server #122 限定为 Pi Chat；其他引擎保留目标身份。
