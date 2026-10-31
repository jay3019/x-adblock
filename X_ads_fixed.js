 * X(Twitter)网页版去广告 - Loon增强版 V3
 * 基于 fmz200 原版 X_ads.js 修改
 *
 * 过滤：
 * 1. 首页推广推文
 * 2. 推文详情及评论区推广内容
 * 3. 推荐关注 / Who to follow 模块
 *
 * 安全：
 * 1. JSON解析失败原样放行
 * 2. 空字段保护
 * 3. 未识别的数据结构不处理
 * 4. 单条内容异常不影响其他内容
 * 5. 无过滤结果时不重新序列化
 */

(function () {
  "use strict";

  function passThrough() {
    $done({});
  }

  // 安全判断对象
  function isObject(obj) {
    return obj !== null && typeof obj === "object";
  }

  // 判断是否为推广内容
  function isPromoted(entry) {
    if (!isObject(entry)) return false;

    var entryId =
      typeof entry.entryId === "string"
        ? entry.entryId.toLowerCase()
        : "";

    var content = isObject(entry.content)
      ? entry.content
      : {};

    var itemContent = isObject(content.itemContent)
      ? content.itemContent
      : {};

    return (
      entryId.indexOf("promoted-tweet") !== -1 ||
      entryId.indexOf("promoted") !== -1 ||
      itemContent.promotedMetadata != null
    );
  }

  // 获取推荐模块标题
  function getHeaderText(entry) {
    if (!isObject(entry)) return "";

    var content = entry.content || {};

    var header =
      content.header ||
      content.timelineModule &&
      content.timelineModule.header ||
      {};

    if (typeof header.text === "string") {
      return header.text.toLowerCase();
    }

    return "";
  }

  // 判断是否为推荐关注模块
  function isWhoToFollow(entry) {
    if (!isObject(entry)) return false;

    var entryId =
      typeof entry.entryId === "string"
        ? entry.entryId.toLowerCase()
        : "";

    var content = entry.content || {};

    var moduleType =
      typeof content.displayType === "string"
        ? content.displayType.toLowerCase()
        : "";

    var header = getHeaderText(entry);

    // 推荐关注模块常见ID
    var idPatterns = [
      "who-to-follow",
      "who_to_follow",
      "who-to-follow-",
      "user-recommend",
      "suggested-users",
      "recommended-users"
    ];

    for (var i = 0; i < idPatterns.length; i++) {
      if (entryId.indexOf(idPatterns[i]) !== -1) {
        return true;
      }
    }

    // 推荐关注模块标题
    if (
      header.indexOf("who to follow") !== -1 ||
      header.indexOf("recommended accounts") !== -1 ||
      header.indexOf("you might like") !== -1 ||
      header.indexOf("推荐关注") !== -1 ||
      header.indexOf("推荐账号") !== -1 ||
      header.indexOf("你可能感兴趣") !== -1
    ) {
      return true;
    }

    // 明确的推荐用户模块类型
    if (
      moduleType.indexOf("who_to_follow") !== -1 ||
      moduleType.indexOf("who-to-follow") !== -1
    ) {
      return true;
    }

    return false;
  }

  // 过滤模块内部的推广内容
  function filterNestedItems(entry) {
    if (
      !isObject(entry) ||
      !isObject(entry.content) ||
      !Array.isArray(entry.content.items)
    ) {
      return 0;
    }

    var items = entry.content.items;
    var oldLength = items.length;

    entry.content.items = items.filter(function (item) {
      try {
        if (!isObject(item)) return true;

        var itemContent =
          item.item && isObject(item.item)
            ? item.item.itemContent || item.item
            : item.itemContent || {};

        var itemId =
          typeof item.entryId === "string"
            ? item.entryId.toLowerCase()
            : "";

        var promoted =
          itemId.indexOf("promoted") !== -1 ||
          (
            isObject(itemContent) &&
            itemContent.promotedMetadata != null
          );

        return !promoted;
      } catch (e) {
        return true;
      }
    });

    return oldLength - entry.content.items.length;
  }

  // 过滤时间线条目
  function filterTimelineInstructions(instructions) {
    var removed = 0;

    if (!Array.isArray(instructions)) {
      return removed;
    }

    instructions.forEach(function (instruction) {
      try {
        if (
          !isObject(instruction) ||
          !Array.isArray(instruction.entries)
        ) {
          return;
        }

        var oldEntries = instruction.entries;

        instruction.entries = oldEntries.filter(function (entry) {
          try {
            if (!isObject(entry)) return true;

            // 1. 推广推文
            if (isPromoted(entry)) {
              removed++;
              return false;
            }

            // 2. 推荐关注模块
            if (isWhoToFollow(entry)) {
              removed++;
              return false;
            }

            // 3. 保留原作者对嵌套推广内容的处理
            removed += filterNestedItems(entry);

            // 如果模块内广告全部删除，则删除空模块
            if (
              entry.content &&
              Array.isArray(entry.content.items) &&
              entry.content.items.length === 0
            ) {
              removed++;
              return false;
            }

            return true;
          } catch (e) {
            return true;
          }
        });
      } catch (e) {
        // 当前 instruction 异常，不影响其他 instruction
      }
    });

    return removed;
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

    // 解析响应
    var json;

    try {
      json = JSON.parse($response.body);
    } catch (e) {
      // 解析失败，原样放行
      passThrough();
      return;
    }

    if (!isObject(json)) {
      passThrough();
      return;
    }

    var removed = 0;
    var instructions = null;

    if (isTimeline) {
      var home =
        json.data &&
        json.data.home &&
        json.data.home.home_timeline_urt;

      if (home && Array.isArray(home.instructions)) {
        instructions = home.instructions;
      }
    }

    if (isTweetDetail) {
      var detail =
        json.data &&
        json.data.threaded_conversation_with_injections_v2;

      if (detail && Array.isArray(detail.instructions)) {
        instructions = detail.instructions;
      }
    }

    // 未识别结构，原样放行
    if (!instructions) {
      passThrough();
      return;
    }

    // 执行过滤
    removed = filterTimelineInstructions(instructions);

    // 无广告被过滤，不修改响应
    if (removed === 0) {
      passThrough();
      return;
    }

    // 输出修改后的JSON
    $done({
      body: JSON.stringify(json)
    });

  } catch (error) {
    // 发生异常，原样放行
    passThrough();
  }
})();

