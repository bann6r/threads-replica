const textOf = (node, selector, fallback = "") => node.querySelector(selector)?.textContent?.trim() ?? fallback;
const xml = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return new DOMParser().parseFromString(await response.text(), "application/xml");
};
const safeCount = (value) => /^\d+$/.test(value) ? Number(value).toLocaleString() : "";
const make = (tag, className, value) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = value;
  return el;
};
function renderProfile(profile) {
  const username = textOf(profile, "username", "username");
  const display = textOf(profile, "displayname", username);
  document.title = `${username} · Threads archive`;
  document.querySelector("#column-title").textContent = username;
  document.querySelector("#profile-displayname").textContent = display;
  document.querySelector("#profile-username").textContent = username;
  document.querySelector("#profile-bio").textContent = textOf(profile, "bio");
  document.querySelector("#profile-avatar").src = textOf(profile, "avatar", "pfp/avatar-placeholder.svg");
  const followers = safeCount(textOf(profile, "followers"));
  document.querySelector("#profile-followers").textContent = followers ? `${followers} followers` : "followers";
  const follow = document.querySelector("#profile-follow-button");
  follow.href = textOf(profile, "follow-url", `https://www.threads.com/@${encodeURIComponent(username)}`);
}
function action(container, icon, count) {
  if (!count) return;
  const item = make("span", "action");
  const img = document.createElement("img");
  img.src = `icons/${icon}.svg`;
  img.alt = "";
  item.append(img, make("span", "action-count", safeCount(count)));
  container.append(item);
}
function renderPost(post) {
  const article = make("article", "post");
  const header = make("header", "post-header");
  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.src = textOf(post, "avatar", "pfp/avatar-placeholder.svg");
  avatar.alt = "";
  const headerContent = make("div", "header-content");
  const row = make("div", "header-row");
  row.append(make("span", "username", textOf(post, "username", "unknown")));
  const date = post.querySelector("date");
  if (date) {
    const dateEl = make("time", "date", date.textContent.trim());
    if (date.getAttribute("datetime")) dateEl.dateTime = date.getAttribute("datetime");
    row.append(dateEl);
  }
  const platform = textOf(post, "platform", "threads").toLowerCase();
  const platformEl = make("span", "platform");
  const platformImg = document.createElement("img");
  platformImg.src = platform === "bsky" ? "icons/bsky.svg" : "icons/threads.svg";
  platformImg.alt = platform === "bsky" ? "Bluesky" : "Threads";
  platformEl.append(platformImg);
  row.append(platformEl);
  headerContent.append(row);
  header.append(avatar, headerContent);
  article.append(header);
  const content = make("div", "post-content");
  content.append(make("p", "post-text", textOf(post, "text")));
  article.append(content);
  const images = [...post.querySelectorAll("images image")];
  const video = textOf(post, "video");
  if (images.length || video) {
    const media = make("div", "post-media");
    images.forEach((node) => {
      const img = document.createElement("img");
      img.src = node.textContent.trim();
      img.alt = "Post media";
      img.loading = "lazy";
      media.append(img);
    });
    if (video) {
      const player = document.createElement("video");
      player.src = video;
      player.controls = true;
      player.preload = "metadata";
      media.append(player);
    }
    content.append(media);
  }
  const counts = make("div", "actions");
  action(counts, "love", textOf(post, "likes"));
  action(counts, "comment", textOf(post, "comments"));
  action(counts, "repost", textOf(post, "reposts"));
  action(counts, "views", textOf(post, "views"));
  if (counts.childElementCount) content.append(counts);
  return article;
}
async function init() {
  const archive = document.querySelector("#archive");
  try {
    const [profile, posts] = await Promise.all([xml("profile.xml"), xml("posts.xml")]);
    const parserError = profile.querySelector("parsererror") || posts.querySelector("parsererror");
    if (parserError) throw new Error("An XML file contains invalid syntax.");
    renderProfile(profile);
    const entries = [...posts.querySelectorAll("archive > post")];
    archive.replaceChildren();
    if (!entries.length) {
      archive.append(make("p", "archive-message", "No posts in this archive yet."));
      return;
    }
    entries.forEach((post, index) => {
      archive.append(renderPost(post));
      if (index < entries.length - 1) {
        const divider = document.createElement("hr");
        divider.className = "post-divider";
        archive.append(divider);
      }
    });
  } catch (error) {
    console.error(error);
    archive.replaceChildren(make("p", "archive-message", `Could not load the archive: ${error.message}`));
  }
}
init();