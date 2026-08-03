## ADDED Requirements

### Requirement: 批量请求契约一致

系统 SHALL 确保所有内容脚本批量翻译入口发送由对象组成的段落数组，每个对象至少包含字符串类型的 `id`、`text` 和 `elementPath`；后台 SHALL 对异常负载返回可诊断错误。

#### Scenario: 全页翻译构造批量请求

- **WHEN** 内容脚本收到全页翻译指令并找到可翻译段落
- **THEN** 发送给后台的每个段落均包含 `id`、`text` 和 `elementPath`

#### Scenario: 后台收到异常批量负载

- **WHEN** 后台收到包含字符串段落或缺少必填字段的批量请求
- **THEN** 后台返回失败响应且不会抛出未捕获异常

### Requirement: 批量翻译遵循供应商能力

系统 SHALL 根据活动供应商的认证要求和响应格式执行批量翻译，而不是对所有供应商强制要求 API Key 或结构化 JSON。

#### Scenario: 免费 Google 翻译没有 API Key

- **WHEN** 活动供应商为免费 Google 翻译且未配置 API Key
- **THEN** 批量翻译仍调用免费翻译路径并返回段落结果

#### Scenario: Ollama 没有 API Key

- **WHEN** 活动供应商为 Ollama 且未配置 API Key
- **THEN** 批量翻译继续调用本地模型端点

### Requirement: 传统供应商响应规范化

系统 SHALL 将传统翻译供应商返回的纯文本转换为统一的 `TranslationResult`，不得交给 LLM JSON 解析器。

#### Scenario: Google Cloud 返回纯文本

- **WHEN** Google Cloud 翻译成功返回译文字符串
- **THEN** 调用方收到包含该译文的有效 `TranslationResult`

#### Scenario: Youdao 返回纯文本

- **WHEN** Youdao 翻译成功返回译文字符串
- **THEN** 调用方收到包含该译文的有效 `TranslationResult`

### Requirement: 全页右键菜单独立校验

系统 SHALL 在没有选中文本时仍处理“翻译整个页面”菜单操作。

#### Scenario: 无选区触发全页翻译

- **WHEN** 用户在有效标签页点击“翻译整个页面”且没有选中文本
- **THEN** 后台向该标签页发送全页翻译消息

### Requirement: 自定义端点主机权限

系统 SHALL 在测试或保存自定义 API 端点前检查并申请对应源站的可选主机权限，并在权限被拒绝时阻止网络请求。

#### Scenario: 用户授予自定义端点权限

- **WHEN** 用户测试一个尚未授权的有效自定义端点并授予权限
- **THEN** 系统在授权后执行连接测试

#### Scenario: 用户拒绝自定义端点权限

- **WHEN** 用户拒绝自定义端点的主机权限
- **THEN** 系统返回明确失败信息且不调用该端点

### Requirement: 活动配置决定翻译路由

系统 SHALL 只根据当前活动配置选择供应商专用路径，非活动配置不得改变翻译路由。

#### Scenario: 非活动 DeepL 配置存在密钥

- **WHEN** 当前活动供应商为 OpenAI 且另一个非活动 DeepL 配置含密钥
- **THEN** 系统使用 OpenAI 路径而不是 DeepL 路径

#### Scenario: 活动供应商为 DeepL

- **WHEN** 当前活动配置为含有效密钥的 DeepL
- **THEN** 系统使用 DeepL 专用翻译路径

### Requirement: 双凭证配置完整生效

系统 SHALL 从活动配置读取并应用 `secondaryApiKey`，同时保留旧版顶层字段回退能力。

#### Scenario: 活动 Baidu 配置包含双密钥

- **WHEN** 活动 Baidu 配置同时包含主 API Key 和次级 API Key
- **THEN** 后台设置包含两项凭证并可用于签名请求

#### Scenario: 唯一配置尚未记录活动 ID

- **WHEN** 设置中只有一个 API 配置且尚未记录 `activeApiConfigId`
- **THEN** 系统自动将该配置作为活动配置并读取其 API Key

### Requirement: 批量失败请求正确收尾

系统 SHALL 使用入队时生成的真实请求 ID 更新失败状态并清理请求记录。

#### Scenario: 批量服务抛出错误

- **WHEN** 已入队的批量翻译服务执行失败
- **THEN** 队列失败处理收到与入队相同的请求 ID
