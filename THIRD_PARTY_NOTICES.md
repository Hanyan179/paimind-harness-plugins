# 第三方与许可范围

本文件按当前仓库已存在的 manifest、LICENSE、NOTICE 和 PROVENANCE 整理，不是新许可证或完整法律结论。原文件及版权保持不变。

## 范围清单

| 内容 | 现有证据 | 处理边界 |
| --- | --- | --- |
| 主项目及部分产品包 | 根无统一 LICENSE；[harness-bundle](packages/harness-bundle/package.json)、[skill-market](packages/skill-market/package.json) 明确 `UNLICENSED` | 不将整个公开仓库称为统一 MIT/Apache 开源作品 |
| 内部业务技能 | [INTERNAL-LICENSE](packages/skill-market/catalog/INTERNAL-LICENSE.txt) 与 [实际目录映射](packages/skill-market/src/recommended.ts) | 现有声明限定内部使用并限制外发；需权利人决定，不能由本文件扩大许可 |
| sol-catalog-sync 参考代码 | [provenance.json](examples/sol-catalog-sync/provenance.json) | 原记录未提供再分发许可，内部改写授权不等于公开授权 |
| workspace-editors 导入 | [PROVENANCE](packages/workspace-editors/PROVENANCE.json)、[LICENSE](packages/workspace-editors/LICENSE)、[NOTICE](packages/workspace-editors/NOTICE) | 保留 Cloudflare 来源、固定提交、原始/改写哈希和 Apache 文本 |
| context-library 参考 | [PROVENANCE](packages/context-library/PROVENANCE.json) | 记录为设计参考、未复制参考源码；与实际 vendor 导入区分 |
| 改写的 OpenAI 相关技能 | catalog 下各 NOTICE 及 [许可文本](packages/skill-market/catalog/LICENSE.txt) | 保留原声明，继续核实精确上游版本/URL及各项适用范围 |
| human-writing | [LICENSE](resources/business-skills/human-writing/LICENSE)、[PROVENANCE](resources/business-skills/human-writing/PROVENANCE.json) | 保留 MIT 与导入证据；本机来源路径和哈希不是完整的上游权属证明 |
| lark-doc、lark-shared | 各目录的 PROVENANCE | 目前未建立对应再分发许可结论，不默认为项目原创或许可已齐 |
| 运行时、provider 与 npm 依赖 | manifest、锁文件及[兼容矩阵](docs/compatibility/matrix.md) | 各自遵循对应版本条款；兼容性通过不等于许可核验通过 |

本表只链接已经存在的材料，不复制受限技能正文、参考实现、个人路径或业务数据。

## 素材和业务资料

品牌标志、人物图像、业务故事板、工作区模板、截图与企业数据可能有独立权利和隐私要求。源码许可、用户提供、本机导入、来源哈希或网页可访问，都不能单独证明这些素材可公开再分发。

需要对具体文件记录：来源、权利人、精确版本/哈希、使用位置、许可原文、必须保留的声明、改写范围和核对状态。无法建立授权的部分保持待确认，不填入推测的 SPDX 或新的版权主体。

## 发布边界

本仓公开访问状态及 npm 命名空间不代表所有包、技能和示例已获准外发。当前受限材料需要授权证明或经批准的替换/移除方案；本次文档更新不执行许可变更、删历史或改可见性。

完整依赖、所有分支/历史与二进制素材尚未被本轮全部审查。后续检查见 [发布准备](docs/guides/release-readiness.md)。
