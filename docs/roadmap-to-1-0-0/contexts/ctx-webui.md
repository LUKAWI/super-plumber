# 呈现层（web-ui 星空）（ctx-webui）

负责 web-ui/（只读星空前端）的呈现层：星图与图库、决策文档入口、前沿视图、雾区云团、术语 Avoid 呈现。不负责机器面与读接口实现（归 ctx-tooling）、话术与提示词资产（归 ctx-skills-plugin）、版本发布与治理（归 ctx-release-ops）；呈现所需数据一律来自既有读接口，不新增数据面。

## 术语表

- **前沿（frontier）**: ready 与 ready_eligible 两桶的合并视图——「现在就能干的活」的一键档；不是新调度桶，只是呈现层合并。
- **雾区云团**: 星空对 graph 级 fog 字段的呈现形态（虚线云团），不引入独立数据面。
- **Avoid 呈现**: 术语 definition 尾部反模式尾注（Avoid 尾注，记法约定见 manual §2.4）的识别与高亮呈现，先按约定解析、schema 字段后置。
- **视图平移（pan）**: 只改变观察范围、不改变图数据或节点位置的画布移动；桌面鼠标默认由中键拖动触发，不等同于节点拖动。

> 本文由 `graph export` 从 context 顶点 ctx-webui 生成（节点即文档，图是真相源）。
