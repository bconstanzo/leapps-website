# Blog images

Images used in blog posts live here, organized into one folder per post
(matching the post's slug):

```
blog/images/<post-slug>/your-image.png
```

For example, a post at `blog/posts/2026-06-05-my-post.md` keeps its images in
`blog/images/2026-06-05-my-post/`.

## Referencing images in a post

Images are served through the [jsDelivr](https://www.jsdelivr.com/) CDN straight
from this repo. Reference them in Markdown with the **full absolute URL**:

```markdown
![Descriptive alt text](https://cdn.jsdelivr.net/gh/abrignoni/leapps-website@main/blog/images/<post-slug>/your-image.png)
```

### Rules

- **Always use the full jsDelivr URL.** Relative paths like `images/foo.png` do
  **not** work — posts are rendered from a shared page, so paths must be absolute.
- **Commit images in the same pull request as the post** so the post and its
  images are reviewed and merged together.
- **Always include alt text** (the text in square brackets) for accessibility.
- Keep files reasonably sized (compress screenshots; aim for < ~300 KB each) so
  posts stay fast to load.
- Supported formats: PNG, JPG, GIF, WebP.
