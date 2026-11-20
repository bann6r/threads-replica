(function () {
  'use strict';
  var XML_URL = 'posts.xml';

  // Direct-child lookups only: a <quote> has the same field names as its post, so a descendant search
  // would let a missing post field pick up the quote's value.
  function first(el, tag) {
    for (var n = el ? el.firstElementChild : null; n; n = n.nextElementSibling) if (n.localName === tag) return n;
    return null;
  }
  function list(el, tag) {
    var out = [];
    for (var n = el ? el.firstElementChild : null; n; n = n.nextElementSibling) if (n.localName === tag) out.push(n);
    return out;
  }
  function val(el, tag) { var n = first(el, tag); return n ? n.textContent.trim() : ''; }

  function fields(el) {
    var d = first(el, 'date');
    return {
      username: val(el, 'username'),
      platform: val(el, 'platform'),
      avatar: val(el, 'avatar'),
      dateText: d ? d.textContent.trim() : '',
      dateTime: d ? (d.getAttribute('datetime') || '').trim() : '',
      text: val(el, 'text')
    };
  }

  function parsePosts(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('posts.xml is not valid XML');
    return Array.prototype.map.call(doc.getElementsByTagName('post'), function (p) {
      var post = fields(p), q = first(p, 'quote');
      post.images = list(first(p, 'images'), 'image').map(function (n) { return n.textContent.trim(); }).filter(Boolean);
      post.videos = list(p, 'video').concat(list(first(p, 'videos'), 'video'))
        .map(function (n) { return n.textContent.trim(); }).filter(Boolean);
      post.counters = { likes: val(p, 'likes'), comments: val(p, 'comments'), reposts: val(p, 'reposts') };
      post.quote = q ? fields(q) : null;                 // nested quotes are not read
      return post;
    });
  }

  function loadXml() {
    return fetch(XML_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .catch(function (err) {
        var fb = document.getElementById('posts-xml-fallback');
        if (!fb) throw err;
        console.warn('[posts.xml] could not be fetched (' + err.message + '). Using the embedded snapshot. ' +
          'Serve this folder over http (e.g. "python -m http.server") to read the live posts.xml.');
        return fb.textContent;
      });
  }

  function longDate(dt) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dt), o;
    if (m) {
      o = new Date(+m[1], +m[2] - 1, +m[3]);
      return isNaN(o) ? '' : o.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
    o = new Date(dt);
    return isNaN(o) ? '' : o.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function safeUrl(u) {
    var m = /^([a-z][a-z0-9+.\-]*):/i.exec(u);
    if (!m) return !/^\s*\/\//.test(u);                    // relative path
    var scheme = m[1].toLowerCase();
    return scheme === 'http' || scheme === 'https' || (scheme === 'data' && /^data:image\//i.test(u));
  }

  // Only swaps the picture once it has loaded, so a missing file keeps the original avatar.
  function setAvatar(img, url) {
    if (!img || !url || !safeUrl(url)) return;
    var probe = new Image();
    probe.onload = function () {
      if (img.style.getPropertyValue('background-image')) {      // post avatar is painted as a background
        img.style.setProperty('background-image', 'url("' + url.replace(/["\\\n\r]/g, encodeURIComponent) + '")', 'important');
      } else {
        img.src = url;
      }
    };
    probe.onerror = function () { console.warn('[posts.xml] avatar not found, keeping original: ' + url); };
    probe.src = url;
  }

  function setText(el, text) {
    el.textContent = '';
    text.split(/\r?\n/).forEach(function (line, i) {
      if (i) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(line));
    });
  }

  function renameUser(root, from, to, skipPosts) {
    if (!from || !to || from === to) return;
    function skip(n) { return skipPosts && n.closest('[data-xml-post]'); }
    Array.prototype.forEach.call(root.querySelectorAll('a[href*="/@"]'), function (a) {
      if (!skip(a)) a.setAttribute('href', a.getAttribute('href').split('/@' + from).join('/@' + to));
    });
    Array.prototype.forEach.call(root.querySelectorAll('[alt]'), function (n) {
      if (!skip(n)) n.setAttribute('alt', n.getAttribute('alt').split(from).join(to));
    });
  }

  // Puts the count right after its icon, colored from the same --x-color the icon uses.
  // Missing / empty value -> no number at all (and no extra gap).
  function setCounter(root, key, value) {
    var icon = root.querySelector('svg[data-xml-counter=' + key + ']');
    if (!icon) return;
    var box = icon.parentElement;
    var pill = box.parentElement;                 // the 36px round hit-area around the icon
    var old = box.querySelector('.xml-counter');
    if (old) old.remove();
    pill.classList.remove('xml-has-counter');
    box.style.removeProperty('--x-columnGap');
    box.style.setProperty('--x-columnGap', '0px');
    if (value === undefined || value === null || String(value).trim() === '') return;
    var span = document.createElement('span');
    span.className = 'xml-counter';
    span.textContent = String(value).trim();
    var c = icon.style.getPropertyValue('--x-color');
    if (c) span.style.setProperty('--x-color', c); else span.style.color = getComputedStyle(icon).color;
    box.style.setProperty('--x-columnGap', '4px');
    pill.classList.add('xml-has-counter');        // grows with the number so the icon keeps its position
    box.appendChild(span);
  }

  // ---- full-size viewer (instant open/close, no animation) ----
  var lb = null, lbImg = null, lbReturn = null;
  function closeViewer() {
    if (!lb || lb.hidden) return;
    lb.hidden = true;
    lbImg.removeAttribute('src');
    if (lbReturn && lbReturn.focus) { try { lbReturn.focus({ preventScroll: true }); } catch (e) {} }
    lbReturn = null;
  }
  function openViewer(src, from) {
    if (!lb) {
      lb = document.createElement('div');
      lb.className = 'xml-lightbox';
      lb.hidden = true;
      lb.setAttribute('role', 'dialog');
      lb.setAttribute('aria-modal', 'true');
      lb.setAttribute('aria-label', 'Image viewer');
      lbImg = document.createElement('img');
      lbImg.className = 'xml-lightbox-img';
      lbImg.alt = '';
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'xml-lightbox-close'; x.setAttribute('aria-label', 'Close'); x.textContent = '\u00d7';
      x.addEventListener('click', closeViewer);
      lb.appendChild(lbImg); lb.appendChild(x);
      lb.addEventListener('click', function (e) { if (e.target === lb) closeViewer(); });   // click outside the image
      ['wheel', 'touchmove'].forEach(function (ev) { lb.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false }); });
      document.addEventListener('keydown', function (e) {
        if (lb.hidden) return;
        if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeViewer(); }
        else if (e.key === 'Tab') { e.preventDefault(); lb.querySelector('button').focus(); }
      });
      document.body.appendChild(lb);
    }
    lbReturn = from || null;
    lbImg.src = src;
    lb.hidden = false;
    lb.querySelector('button').focus({ preventScroll: true });
  }

  // ---- image previews under the post text ----
  function setImages(root, urls) {
    var actions = root.querySelector('[data-xml-actions]');
    var old = root.querySelector('.xml-media');
    if (old) old.remove();
    if (!actions || !urls || !urls.length) return;
    var box = document.createElement('div');
    box.className = 'xml-media';
    urls.forEach(function (url) {
      if (!safeUrl(url)) { console.warn('[posts.xml] image skipped (unsupported URL): ' + url); return; }
      var item = document.createElement('div');
      item.className = 'xml-media-item';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', 'Open image');
      var img = document.createElement('img');
      img.className = 'xml-media-img';
      img.alt = 'Post image';
      img.decoding = 'async';
      img.draggable = false;
      img.addEventListener('error', function () {                       // missing file: drop it, keep the post tidy
        console.warn('[posts.xml] image not found, skipped: ' + url);
        item.remove();
        if (!box.querySelector('.xml-media-item')) box.remove();
      });
      img.src = url;
      item.appendChild(img);
      item.addEventListener('click', function () { openViewer(url, item); });
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openViewer(url, item); }
      });
      box.appendChild(item);
    });
    if (box.firstChild) actions.parentNode.insertBefore(box, actions);
  }

  function setVideos(root, urls) {
    var actions = root.querySelector('[data-xml-actions]');
    var old = root.querySelector('.xml-videos');
    if (old) old.remove();
    if (!actions || !urls || !urls.length) return;
    var box = document.createElement('div');
    box.className = 'xml-media xml-videos';
    urls.forEach(function (url) {
      if (!safeUrl(url)) { console.warn('[posts.xml] video skipped (unsupported URL): ' + url); return; }
      var item = document.createElement('div');
      item.className = 'xml-video-item';
      var video = document.createElement('video');
      video.className = 'xml-video';
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.src = url;
      video.addEventListener('error', function () {
        if (item.querySelector('.xml-video-fallback')) return;
        console.warn('[posts.xml] video could not be played: ' + url);
        var fallback = document.createElement('a');
        fallback.className = 'xml-video-fallback';
        fallback.href = url;
        fallback.textContent = 'This browser could not play the video. Open or download it instead.';
        item.appendChild(fallback);
      });
      item.appendChild(video);
      box.appendChild(item);
    });
    if (box.firstChild) actions.parentNode.insertBefore(box, actions);
  }

  // ---- quoted post ----
  // <platform> value -> icon file (relative to the project folder)
  var PLATFORM_ICONS = { threads: 'icons/threads.svg', bsky: 'icons/bsky.svg' };

  // One renderer for regular posts and quoted posts. Unknown/empty platform: no icon. Missing file: icon is dropped.
  function platformIcon(platform, extraClass, onMissing) {
    var key = String(platform || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(PLATFORM_ICONS, key)) return null;
    var img = document.createElement('img');
    img.className = 'xml-platform' + (extraClass ? ' ' + extraClass : '');
    img.alt = key;
    img.width = 18;
    img.height = 18;
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', function () {
      console.warn('[posts.xml] platform icon not found, skipped: ' + PLATFORM_ICONS[key]);
      img.remove();
      if (onMissing) onMissing();
    });
    img.src = PLATFORM_ICONS[key];
    return img;
  }

  // Regular post: icon sits in the header's right-hand cluster, just left of the "More" button.
  function setPostPlatform(root, platform) {
    var slot = root.querySelector('[data-xml-platform-slot]');
    var old = root.querySelector('.xml-post-platform');
    if (old) old.remove();
    if (!slot) return;
    var icon = platformIcon(platform, 'xml-post-platform');
    if (icon) slot.insertBefore(icon, slot.firstChild);
  }

  // Quoted card below the text/images and above the action bar. Every field is optional.
  function setQuote(root, q) {
    var actions = root.querySelector('[data-xml-actions]');
    var old = root.querySelector('.xml-quote');
    if (old) old.remove();
    if (!actions || !q) return;
    var label = q.dateText || (q.dateTime && longDate(q.dateTime)) || '';
    if (!(q.username || q.text || label || q.avatar)) return;          // empty <quote/>: nothing to show

    var card = document.createElement('div');
    card.className = 'xml-quote';
    card.setAttribute('data-xml-quote', '');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Quoted post');
    if (q.platform) card.setAttribute('data-platform', q.platform);

    if (q.username || label || q.avatar) {
      var head = document.createElement('div');
      head.className = 'xml-quote-header';
      var av = document.createElement('span');                          // neutral circle until the picture loads
      av.className = 'xml-quote-avatar';
      av.setAttribute('aria-hidden', 'true');
      av.style.setProperty('background-image', 'none');
      head.appendChild(av);
      var who = document.createElement('div');
      who.className = 'xml-quote-author';
      if (q.username) {
        var u = document.createElement('span');
        u.className = 'xml-quote-username';
        u.textContent = q.username;
        who.appendChild(u);
      }
      if (label) {
        var d = document.createElement('time');
        d.className = 'xml-quote-date';
        d.textContent = label;
        if (q.dateTime) {
          d.setAttribute('datetime', q.dateTime);
          var tip = longDate(q.dateTime);
          if (tip) d.setAttribute('title', tip);
        }
        who.appendChild(d);
      }
      head.appendChild(who);
      card.appendChild(head);
      setAvatar(av, q.avatar);                                          // same loader as the post avatar
    }
    if (q.text) {
      var c = document.createElement('div');
      c.className = 'xml-quote-content';
      setText(c, q.text);
      card.appendChild(c);
    }
    var icon = platformIcon(q.platform, 'xml-quote-platform', function () { card.classList.remove('xml-quote--platform'); });
    if (icon) { card.appendChild(icon); card.classList.add('xml-quote--platform'); }
    actions.parentNode.insertBefore(card, actions);
  }

  function fillPost(root, post, origUser) {
    root.setAttribute('data-xml-post', '');
    if (post.platform) root.setAttribute('data-platform', post.platform);
    if (post.username) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-xml-field=username]'), function (n) { n.textContent = post.username; });
      renameUser(root, origUser, post.username);
    }
    var t = root.querySelector('[data-xml-field=text]');
    if (t) setText(t, post.text);
    var d = root.querySelector('[data-xml-field=date]');
    if (d) {
      var label = post.dateText || (post.dateTime && longDate(post.dateTime)) || '';
      if (label) d.textContent = label;
      if (post.dateTime) {
        d.setAttribute('datetime', post.dateTime);
        var tip = longDate(post.dateTime);
        if (tip) d.setAttribute('title', tip);
      }
    }
    setAvatar(root.querySelector('img[data-xml-field=avatar]'), post.avatar);
    setPostPlatform(root, post.platform);
    setImages(root, post.images);
    setVideos(root, post.videos);
    setQuote(root, post.quote);
    ['likes', 'comments', 'reposts'].forEach(function (k) { setCounter(root, k, post.counters[k]); });
  }

  function apply(posts) {
    var tpl = document.querySelector('[data-xml-post-template]');
    var nameEl = document.querySelector('[data-xml-field=username]');
    if (!posts.length || !tpl || !nameEl) return;
    var origUser = nameEl.textContent.trim();

    // build the cards from the untouched template first
    var cards = [tpl], prev = tpl;
    for (var i = 1; i < posts.length; i++) {
      var c = tpl.cloneNode(true);
      c.removeAttribute('data-xml-post-template');
      prev.parentNode.insertBefore(c, prev.nextSibling);
      cards.push(c); prev = c;
    }
    cards.forEach(function (c, i) { fillPost(c, posts[i], origUser); });

    // profile-level bits (top bar, profile name, picture, links) follow the first post
    var main = posts[0];
    Array.prototype.forEach.call(document.querySelectorAll('[data-xml-field=username]'), function (n) {
      if (!n.closest('[data-xml-post]') && main.username) n.textContent = main.username;
    });
    if (main.username) {
      renameUser(document.body, origUser, main.username, true);
      document.title = document.title.split('@' + origUser).join('@' + main.username);
    }
    Array.prototype.forEach.call(document.querySelectorAll('img[data-xml-field=avatar]'), function (img) {
      if (!img.closest('[data-xml-post]')) setAvatar(img, main.avatar);
    });
    if (main.platform) {
      document.documentElement.setAttribute('data-platform', main.platform);
      var label = main.platform.charAt(0).toUpperCase() + main.platform.slice(1);
      document.title = document.title.replace(/•\s*Threads/, '• ' + label);
    }
  }

  loadXml().then(parsePosts).then(apply).catch(function (e) {
    console.error('[posts.xml] not applied, page left unchanged:', e);
  });
})();
