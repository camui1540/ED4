# Earthdawn 4E 架构快照

## 1. 技术栈与外部接入点
- **栈**：React 19 + Vite 8 + TS 7 + Tailwind v4（OKLCH 暗/明主题、`@media print` A4）+ `lucide-react` + `exceljs`/`xlsx`/`jszip` + `@supabase/supabase-js`。
- **字体回退**：展示 `SuCaiJiShi-SheHuiTi`/`Source Han Serif CN for Display`→`Georgia,serif`；正文 `Sarasa Gothic/UI SC`→`system-ui,sans-serif`；像素 `Cubic 11`；等宽 `JetBrains Mono`→`ui-monospace,monospace`。打印前 `prewarmPrintFonts` 预热。
- **Supabase**（`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`，缺省降级单机）：表 `rooms`/`room_logs`/`room_characters`。战局频道 `ed4-room-${code}` 监听三表 `postgres_changes`；音乐频道 `trpg-bgm-${code}` 使用 Presence(`sync`/`join`) + Broadcast(`bgm`/`bgm_fade`/`sync_req`, `self:false`)。
- **R2 音频**：`bgmPlaylist` 校验 `http(s)://`|`/` 直链；`bgmAudioEngine` 用 `Audio(crossOrigin='anonymous')` 接 WebAudio `MediaElementSource→BiquadFilter(lowpass 20k/800Hz)→Gain(0.75s/6s淡变)→destination`。
- **存储 Key**（无 IndexedDB）：`localStorage`=`ed4_pl_sheet`、`ed4_theme`、`ed4_sidebar_width`、`ed4_bgm_playlist_v1`；`sessionStorage`=`ed4_client_id`。

## 2. 文件职责地图
- `index.html`/`src/main.tsx`/`src/index.css`：入口、防闪烁主题脚本、字体与打印样式。
- `src/App.tsx`：全局状态、持久化、战斗/施法/导出与联机编排（`default App`）。
- `src/engine/ed4_engine.js`(+`.d.ts`)：规则/掷骰/导入（`ED4Engine`: `getStepDice`, `rollExplodingDie`, `rollStepTest`, `getDisciplineBonuses`, `parseItemBonuses`, `calcEquippedBonuses`, `calcPlDerived`, `getPlActionMod`, `findSpellInDb`, `hasSpellEffectRoll`, `getThreadWeavingStep`, `getSpellcastingStep`, `resolveDamage`, `resolveAvoidBlow`, `resolveRiposte`, `normalizeActionType`, `lookupTalentSkillRule`, `parseExcelWorkbook`, `parseTxtSheet`）。
- `src/engine/ed4_spells_data.js`：216 条法术库（`SPELLS_DB`）。
- `src/engine/spellRules.ts`：脉路上限/TMD/效果/Buff（`emptyBuffModifiers`, `enrichSpellWithDb`, `hydrateSpellsWithDb`, `getCircleExtraThreadCap`, `isVersatilityWeaving`, `getExtraThreadRuleInfo`, `resolveWeavingRollOutcome`, `resolveCastingDn`, `parseBaseSpellEffectStep`, `computeSpellDurationPlan`, `computeSpellEffectPlan`, `getBuffTargetKind`, `buildActiveBuffEntry`, `computeActiveBuffModifiers`, `isRangedWeaponName`, `getWeaponBuffEffects`）。
- `src/engine/combatHelpers.ts`：初始状态/衍生视图/受创（`createInitialState`, `getPlDerivedView`, `getEffectiveActionMod`, `getMonsterEffectiveDef`, `sortInitiativeList`, `createMonsterInstance`, `applyDamageToMonsterPure`, `applyDamageToPlPure`, `applyImportedCharacter`, `formatTime`）。
- `src/engine/characterExport.ts`(+`src/templates/ed4TemplateBase64.ts`)：模板注入导出与立绘提取（`shiftColumnBlockDown`, `extractPortraitFromXlsxBuffer`, `exportCharacterExcelBuffer`, `serializeCharacterToTxt`, `getExportBaseName`, `ED4_TEMPLATE_BASE64`）。
- `src/engine/browserUtils.ts`：浏览器剪贴板与文件下载工具（`copyText`, `downloadBlob`）。
- `src/engine/supabaseSync.ts`：联机 CRUD/订阅/合并/暗骰脱敏（`isSupabaseConfigured`, `supabase`, `getSessionClientId`, `generateRoomCode`, `extractRoomCodeFromUrl`, `buildRoomInviteUrl`, `serializeRoomCore`, `buildRoomStatePayload`, `buildCharacterSyncPayload`, `buildLogInsertPayload`, `buildBlindRollPayload`, `mapBlindRollToLog`, `mapRemoteLogRow`, `mergeCharacterList`, `mergeIncomingLogs`, `createRoomInSupabase`, `joinRoomInSupabase`, `pushRoomStateToSupabase`, `pushCharacterToSupabase`, `removeCharacterFromSupabase`, `pushLogsToSupabase`, `subscribeRoomRealtime`）。
- `src/engine/bgmAudioEngine.ts` / `bgmPlaylist.ts`：扁平音轨引擎（`BGM_AUDIO_CONFIG`, `createBgmAudio`, `setBgmPlayMode`, `setBgmLongFade`, `setBgmTrack`, `playBgm`, `pauseBgm`, `toggleBgmMuffled`, `seekBgmByRatio`, `getBgmCurrentTime`, `destroyBgmAudio`, `unlockBrowserAudio`）与歌单工具（`isValidAudioUrl`, `add/remove/getNextTrack*`, `serialize/parseImportedPlaylistJson`, `load/savePlaylistFromStorage`, `formatBgmTime`, `shouldTriggerTailFade`）。
- `src/components/uiShared.ts` + `src/components/*`：共享样式常量与门类加值标签（`inputCls`, `noSpinInputCls`, `btnCls`, `btnPrimaryCls`, `btnSmCls`, `sectionCls`, `getDisciplineBonusTags`）；页面视图 `PlSheetView`, `GmMonsterView`, `RightSidebar`, `BgmPlayer`, `SpellEffectModal`, `PrintSheetView`, `StepTableView`, `Modals`（`SpellJsonModal`/`ManualModal`/`ExportModal`/`RoomModal`）。

## 3. 核心扁平数据结构契约（严禁私自改动）
1. **PL 卡(`state.pl`/`ed4_pl_sheet`)与怪物**：
   - 基础：`name,raceId,disciplineId,circle,karmaDie,gender,age,height,weight,eyeColor,hairColor,skinColor,portraitUrl,background`
   - 数值：`attrMods{DEX,STR,TOU,PER,WIL,CHA}`, `currentDamage,bloodDamage,wounds,karmaCurrent,recoveryCurrent,initBonus`, `armor{name,pa,ma,initPen}`, `shield{name,pd,md,initPen}`, `options{aggressive,defensive,knockdown,stun,splitMove,tailAttack}`, `statuses{knockedDown,blindsided,surprised,harried,reserved}`
   - 列表：`talents[{id,name,attr,rank,action,strain,isAttack}]`, `skills[{...category}]`, `weapons[{id,name,dmgStep}]`, `gear[{name,rank,effect,equipped}]`, `threadItems[{name,type,effect,equipped}]`, `legend{total,current,renown}`, `wealth{gold,silver,copper,other}`。TXT 为分段键值无损序列化；XLSX 按左`A:G`/中`I:Q`/右`R:Z`锚点读写。
   - 怪物：`{id,instanceId,templateId,name,initStep,pd,md,sd,pa,ma,atkStep,dmgStep,kdStep,recStep,woundThreshold,uncon,death,currentDamage,wounds,knockedDown,blindsided,harried}`。
2. **法术书与实时效果**：
   - `pl.spells[]`：`{instanceId,id,discipline,circle,nameCn,nameEn,threads,weavingBase,weavingHigh,castingType,castingDn,range,duration,aoe,effectFormula,effectType,armorType,extraThreads[],extraEffectStepPerThread,desc,inMatrix,wovenThreads,matchedDb}`。
   - `pendingSpellCasts[id]`：`{instanceId,extraThreadsCount,castingExtraSuccesses,tmdUsed,targetLabel}`。
   - `pl.activeBuffs[]`：`{id,spellId,nameCn,targetKind,targetItemId?,targetItemName?,summary,durationDisplay,modifiers{pa,ma,pd,md,sd,move,actionStep,allAtk,meleeAtk,rangedAtk,initStep,mysticArmorIgnore?},weaponBonus?{dmgStepBonus,extraDice?,note?}}`。
3. **联机广播与房间载荷**：
   - `room_logs`：`{id,room_code,sender_id,sender_name,sender_role,time,text,detail,type,blind_text}`（PL+`gmBlind` 时显示 `blind_text` 并遮蔽 `detail`）。
   - `BLIND_ROLL`（GM 纯暗骰 Broadcast 事件，频道 `ed4-room-${code}`）：`{id,type:'BLIND_ROLL',sender:'GM',timestamp}`（发送端剥离全部点数、Step 与明细，仅 GM 本地保留完整明细并标注 `[暗骰]`；玩家端仅渲染「GM 进行了暗骰」）。
   - `rooms.state`：`{round,turnIndex,initiativeList[],monsters[],pendingReaction|null,gmBlind,updatedBy,updatedAt}`。
   - `room_characters`：`{id,room_code,client_id,nickname,role,char_name,race_id,discipline_id,circle,current_damage,blood_damage,wounds,eff_uncon,eff_death,pd,md,pa,ma,init_step,dex_val,karma_current,karma_max,recovery_current,recovery_max,woven_spells[],equipped_items[],statuses,options,updated_at}`。

## 4. 核心业务与联机数据流
- **Step 与爆骰**：`calcPlDerived`→`getPlDerivedView`(合入 Buff)→`getEffectiveActionMod`(动作检定用，伤害隔离)→`getStepDice` 拆骰组→`rollStepTest` 调 `rollExplodingDie` 累加并判全1大失败与 `floor((total-dn)/5)` 额外成功。
- **法术应用**：`handleWeaveSpell`(依 `getExtraThreadRuleInfo` 限脉路)→`handleCastSpell`(`resolveCastingDn` 掷施法，写 `pendingSpellCasts` 并归零 `wovenThreads`)→`SpellEffectModal`→`handleConfirmSpellEffect`(`computeSpellEffectPlan`→Buff 经 `buildActiveBuffEntry` 入 `activeBuffs`，伤害经 `applyDamageToMonsterPure` 结算)。
- **R2 音乐同步**：GM 操作→`BgmAudioEngine` 播放并 Broadcast `bgm`/`bgm_fade`(含 `updatedAt`/`position`)→PL 补偿延迟同步播放与低通闷音；新进房发 `sync_req` 触发重播；尾段 ≤6s 经 `shouldTriggerTailFade` 自动淡出切曲。
- **Supabase 战报流**：本地 `makeLog`→`useEffect` 按 `knownLogIdsRef` 分流：普通战报批量 `pushLogsToSupabase`，GM 暗骰仅发 `BLIND_ROLL` 脱敏广播（不入库明细）→远端经 `onLogInsert`/`onBlindRoll` 合入；角色卡 300ms 防抖同步 `room_characters`；战局 80ms 防抖推 `rooms.state`（`isApplyingRemoteStateRef` 防回环）。

## 5. 扁平化铁律合规审计（历史技术债清单）
1. ~~**扁平化** `bgmAudioEngine.ts:class BgmAudioEngine`：类封装状态，改顶层纯对象+顶层函数。~~（已清理）
2. ~~**收敛** `App.tsx:handleCopyTxt/copyPlainText` & `Modals.tsx:SpellJsonModal.handleCopy`：3处重复剪贴板降级复制，合为单一 `copyText`。~~（已清理）
3. ~~**收敛** `characterExport.ts:downloadTextFile/downloadExcelBuffer` & `BgmPlayer.tsx:handleExportPlaylist` & `Modals.tsx:SpellJsonModal.handleDownload`：4处重复 Blob 下载，合为 `downloadBlob`。~~（已清理）
4. ~~**收敛** `spellRules.ts:buildPlayerNonRollSummary` vs `buildActiveBuffEntry`：重复维护同类 Buff 法术公式，收敛为单一求值表。~~（已清理）
5. ~~**收敛** `combatHelpers.ts:applyDamageToMonsterPure` vs `applyDamageToPlPure`：受创/负伤/击倒流程重复，合并按目标类型分流。~~（已清理）
6. ~~**收敛** `App.tsx:onLogInsert/handleJoinRoom`（重复日志脱敏映射）及4处重复 `rooms.state` 序列化：抽为 `mapRemoteLogRow`/`serializeRoomCore`。~~（已清理）
7. ~~**收敛** `PlSheetView`/`GmMonsterView`/`RightSidebar`/`BgmPlayer`（4处重复 `inputCls`/`btnCls`）与 `PlSheetView`/`PrintSheetView`（2处重复 `bonusTags`）：抽离共享常量与函数。~~（已清理）
8. ~~**收敛** `ed4_engine.js:parseExcelWorkbook`（天赋/技能两处重复动作负荷提取）及 `getThreadWeavingStep` vs `spellRules.ts:isVersatilityWeaving`：合并复用。~~（已清理）
9. ~~**结构** `ed4_engine.js:DISCIPLINES.*.bonuses` vs `getDisciplineBonuses`：嵌套 `bonuses` 未读取，函数误读不存在的 `disc.c4/c7` 死字段；统一单层表并修复。~~（已清理）
10. ~~**结构** `ed4_engine.js:LEGACY_SPELL_ID_MAP`/`SPELL_ALIASES`/`SPELLS_DB[].aliases` 三重映射重叠，收敛为单一扁平 Map。~~（已清理）
11. ~~**死代码** `ed4_engine.js:getPlActionMod` 误读 `options.knockdownAttack`（实为 `options.knockdown`）；`supabaseSync.ts:SUPABASE_SETUP_SQL`、`package.json`（`@google/genai`/`express`/`dotenv`/`motion`/`autoprefixer`）与 `index.html`（`tweakcn.com` 脚本）未用，建议清理。~~（已清理）
12. ~~**冗余校验** `spellRules.ts`（`enrichSpellWithDb`/`computeSpellEffectPlan`/`computeActiveBuffModifiers`/`getWeaponBuffEffects`）与 `ed4_engine.js`（`parseItemBonuses`/`calcEquippedBonuses`/`calcPlDerived`）：纯内部计算存在大量冗余 `Number()||0`/`typeof`/`Array.isArray` 校验，收口至 I/O 边界归一化。~~（已清理）
