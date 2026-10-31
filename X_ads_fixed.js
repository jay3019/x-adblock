
/*
 * X 网页去广告 - 稳定修复版
 * 适用于 Shadowrocket（小火箭）
 *
 * 修复内容：
 * 1. JSON 解析失败时原样放行
 * 2. entryId 等字段增加空值保护
 * 3. 只处理指定的 X GraphQL 接口
 * 4. 单条数据异常不影响其他条目
 * 5. 过滤失败时不破坏原始响应
 */

(function () {
  "use strict";

  function passThrough() {
    $done({});
  }

  // 判断一条数据是否为推广内容
  function isPromotedEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    var entryId =
      typeof entry.entryId === "string"
        ? entry.entryId
        : "";

    var content =
      entry.content && typeof entry.content === "object"
        ? entry.content
        : {};

    var itemContent =
      content.itemContent &&
      typeof content.itemContent === "object"
        ? content.itemContent
        : {};

    return (
      entryId.indexOf("promoted-tweet-") !== -1 ||
      itemContent.promotedMetadata != null
    );
  }

  // 过滤时间线推广条目
  function filterEntries(entries) {
    if (!Array.isArray(entries)) {
      return entries;
    }

    return entries.filter(function (entry) {
      try {
        return !isPromotedEntry(entry);
      } catch (e) {
        return true;
      }
    });
  }

  // 首页及最新时间线
  function filterTimeline(json) {
    var instructions =
      json &&
      json.data &&
      json.data.home &&
      json.data.home.home_timeline_urt &&
      json.data.home.home_timeline_urt.instructions;

    if (!Array.isArray(instructions)) {
      return false;
    }

    var changed = false;

    instructions.forEach(function (instruction) {
      if (
        instruction &&
        Array.isArray(instruction.entries)
      ) {
        var oldLength = instruction.entries.length;

        instruction.entries = filterEntries(
          instruction.entries
        );

        if (instruction.entries.length !== oldLength) {
          changed = true;
        }
      }
    });

    return changed;
  }

  // 推文详情及评论数据
  function filterTweetDetail(json) {
    var instructions =
      json &&
      json.data &&
      json.data.threaded_conversation_with_injections_v2 &&
      json.data.threaded_conversation_with_injections_v2.instructions;

    if (!Array.isArray(instructions)) {
      return false;
    }

    var changed = false;

    instructions.forEach(function (instruction) {
      if (
        !instruction ||
        !Array.isArray(instruction.entries)
      ) {
        return;
      }

      var oldLength = instruction.entries.length;

      instruction.entries = instruction.entries.filter(
        function (entry) {
          try {
            return !isPromotedEntry(entry);
          } catch (e) {
            return true;
          }
        }
      );

      if (instruction.entries.length !== oldLength) {
        changed = true;
      }
    });

    return changed;
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
      /\/i\/api\/graphql\/[^/]+\/(HomeTimeline|HomeLatestTimeline)(?:\?|$)/.test(url);

    var isTweetDetail =
      /\/i\/api\/graphql\/[^/]+\/TweetDetail(?:\?|$)/.test(url);

    if (!isTimeline && !isTweetDetail) {
      passThrough();
      return;
    }

    var json;

    try {
      json = JSON.parse($response.body);
    } catch (e) {
      // 解析失败，原样放行
      passThrough();
      return;
    }

    if (!json || typeof json !== "object") {
      passThrough();
      return;
    }

    var changed = false;

    if (isTimeline) {
      changed = filterTimeline(json) || changed;
    }

    if (isTweetDetail) {
      changed = filterTweetDetail(json) || changed;
    }

    if (!changed) {
      passThrough();
      return;
    }

    $done({
      body: JSON.stringify(json)
    });

  } catch (error) {
    // 任何异常都不破坏原始响应
    passThrough();
  }
})();
