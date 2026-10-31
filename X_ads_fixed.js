 * X 网页去广告 - Loon 增强稳定版 V2
 *
 * 过滤范围：
 * 1. 推广推文 promoted-tweet
 * 2. 嵌套结构中的 promotedMetadata
 * 3. Who to follow / 推荐关注模块
 * 4. 时间线及推文详情中的推广条目
 *
 * 安全策略：
 * 1. 解析失败原样放行
 * 2. 未识别的数据结构原样放行
 * 3. 单条数据处理异常不影响其他数据
 * 4. 只有实际过滤内容时才修改响应
 */

(function () {
  "use strict";

  function passThrough() {
    $done({});
  }

  // 判断对象是否为有效对象
  function isObject(obj) {
    return obj !== null && typeof obj === "object";
  }

  // 检查推广标记
  function hasPromotedMarker(obj, depth) {
    if (!isObject(obj) || depth > 15) {
      return false;
    }

    if (
      typeof obj.entryId === "string" &&
      /promoted-tweet-/i.test(obj.entryId)
    ) {
      return true;
    }

    if (
      obj.promotedMetadata !== undefined &&
      obj.promotedMetadata !== null
    ) {
      return true;
    }

    if (
      obj.itemContent &&
      obj.itemContent.promotedMetadata != null
    ) {
      return true;
    }

    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        continue;
      }

      // 不扫描普通推文文本，避免误删正常内容
      if (
        key === "full_text" ||
        key === "text" ||
        key === "note_tweet"
      ) {
        continue;
      }

      if (isObject(obj[key])) {
        if (hasPromotedMarker(obj[key], depth + 1)) {
          return true;
        }
      }
    }

    return false;
  }

  // 获取推荐模块标题
  function getRecommendationHeader(entry) {
    if (!isObject(entry)) {
      return "";
    }

    var content = entry.content || {};

    var candidates = [
      content.header && content.header.text,
      content.timelineModule &&
        content.timelineModule.header &&
        content.timelineModule.header.text,
      content.displayType
    ];

    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === "string") {
        return candidates[i].toLowerCase();
      }
    }

    return "";
  }

  // 判断是否为推荐关注模块
  function isRecommendationEntry(entry) {
    if (!isObject(entry)) {
      return false;
    }

    var entryId =
      typeof entry.entryId === "string"
        ? entry.entryId.toLowerCase()
        : "";

    // 常见推荐账号模块标识
    if (
      /who[-_]?to[-_]?follow/.test(entryId) ||
      /user[-_]?recommend/.test(entryId) ||
      /account[-_]?recommend/.test(entryId) ||
      /suggested[-_]?users/.test(entryId)
    ) {
      return true;
    }

    // 检查模块标题，不扫描普通推文正文
    var header = getRecommendationHeader(entry);

    if (
      /who to follow/.test(header) ||
      /recommended accounts/.test(header) ||
      /you might like/.test(header) ||
      /推荐关注/.test(header) ||
      /关注推荐/.test(header) ||
      /推荐账号/.test(header)
    ) {
      return true;
    }

    return false;
  }

  // 判断条目是否应该过滤
  function shouldRemove(entry) {
    if (!isObject(entry)) {
      return false;
    }

    try {
      if (isRecommendationEntry(entry)) {
        return true;
      }

      if (hasPromotedMarker(entry, 0)) {
        return true;
      }
    } catch (e) {
      // 判断异常时保留条目
      return false;
    }

    return false;
  }

  // 递归清理时间线数组
  function cleanTree(node, depth) {
    if (!isObject(node) || depth > 20) {
      return 0;
    }

    var removed = 0;

    if (Array.isArray(node)) {
      var filtered = [];

      for (var i = 0; i < node.length; i++) {
        var item = node[i];

        try {
          if (isObject(item) && shouldRemove(item)) {
            removed++;
            continue;
          }

          removed += cleanTree(item, depth + 1);
          filtered.push(item);
        } catch (e) {
          // 异常条目保留
          filtered.push(item);
        }
      }

      node.length = 0;

      for (var j = 0; j < filtered.length; j++) {
        node.push(filtered[j]);
      }

      return removed;
    }

    for (var key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) {
        continue;
      }

      if (isObject(node[key])) {
        removed += cleanTree(node[key], depth + 1);
      }
    }

    return removed;
  }

  // 获取时间线 instructions
  function getTimelineInstructions(json) {
    var home =
      json &&
      json.data &&
      json.data.home &&
      json.data.home.home_timeline_urt;

    return home && Array.isArray(home.instructions)
      ? home.instructions
      : null;
  }

  // 获取推文详情 instructions
  function getTweetDetailInstructions(json) {
    var detail =
      json &&
      json.data &&
      json.data.threaded_conversation_with_injections_v2;

    return detail && Array.isArray(detail.instructions)
      ? detail.instructions
      : null;
  }

  try {
    if (
      typeof $response === "undefined" ||
      !$response ||
      typeof $response.body !== "string" ||
      !$response.body
    ) {
      passThrough();
      return;
    }

    var url =
      typeof $request !== "undefined" &&
      $request &&
      $request.url
        ? String($request.url)
        : "";

    var isTimeline =
      /\/i\/api\/graphql\/[^/]+\/(HomeTimeline|HomeLatestTimeline)(?:\?|$)/i.test(url);

    var isTweetDetail =
      /\/i\/api\/graphql\/[^/]+\/TweetDetail(?:\?|$)/i.test(url);

    if (!isTimeline && !isTweetDetail) {
      passThrough();
      return;
    }

    // 非正常响应不处理
    if (
      typeof $response.status === "number" &&
      ($response.status < 200 || $response.status >= 300)
    ) {
      passThrough();
      return;
    }

    var json;

    try {
      json = JSON.parse($response.body);
    } catch (e) {
      passThrough();
      return;
    }

    if (!isObject(json)) {
      passThrough();
      return;
    }

    var removedCount = 0;
    var instructions = null;

    if (isTimeline) {
      instructions = getTimelineInstructions(json);
    } else if (isTweetDetail) {
      instructions = getTweetDetailInstructions(json);
    }

    // 未识别的数据结构，保持原样
    if (!instructions) {
      passThrough();
      return;
    }

    // 逐条处理 instructions
    for (var i = 0; i < instructions.length; i++) {
      try {
        removedCount += cleanTree(
          instructions[i],
          0
        );
      } catch (e) {
        // 单个 instruction 异常不影响其他内容
      }
    }

    // 没有发现广告，不修改响应
    if (removedCount === 0) {
      passThrough();
      return;
    }

    // 仅在实际过滤后重新生成 JSON
    $done({
      body: JSON.stringify(json)
    });

  } catch (error) {
    // 全局异常保护
    passThrough();
  }
})();

