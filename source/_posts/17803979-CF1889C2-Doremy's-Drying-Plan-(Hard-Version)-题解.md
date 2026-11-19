---
title: CF1889C2 Doremy's Drying Plan (Hard Version) 题解
date: '2023-11-01 20:00:00'
categories:
- 题解
tags:
- OI 时期
permalink: /p/17803979/
description: 有 \\(n\\) 个点和 \\(m\\) 条线段，你可以选择 \\(k\\) 条线段删除，最大化未被线段覆盖的点的数量，输出最大值，\\(n, m \\le 2 \\times 10^5, k \\le \\min(m, 10)\\)
cover: /images/covers/solution.svg
top_img: /images/banner.svg
toc: true
mathjax: true
---

### Description

有 \\(n\\) 个点和 \\(m\\) 条线段，你可以选择 \\(k\\) 条线段删除，最大化未被线段覆盖的点的数量，输出最大值，\\(n, m \\le 2 \\times 10^5, k \\le \\min(m, 10)\\)

### Solution

一道比较好玩的 dp 题。建议评级紫。

单独考虑每个点。设现在在考虑点 \\(i\\)，如果我们需要让 \\(i\\) 不被覆盖，那么我们要清空覆盖在它上面的所有线段。

如果我们按顺序考虑每个点是否不被覆盖，即在 \\(i\\) 前面也去删除了一些线段，那么这时我们发现有些覆盖在 \\(i\\) 上面的线段之前已经删过了，而其决定因素在上一个没被覆盖的点的位置，原因如下。

![image](/images/cnblogs/17803979/01-3254945-20231101152426803-825393125.png)

考虑 \\(t\\) 和 \\(i\\) 两个点和三条线段。对于 \\(i\\) 和 \\(t\\)，与这两个点有关的线段只有三类，如图中的紫色、红色、绿色线段所示。假设现在在希望让 \\(i\\) 点不被覆盖。首先紫色线段与 \\(i\\) 完全无关，不会产生贡献。设 \\(t\\) 是上一个没被覆盖的点，那么在考虑 \\(t\\) 的时候就会把红色线段删掉，而在考虑 \\(i\\) 的时候就不用删去红色线段。在这种情况下 \\(i\\) 只需要删去绿色线段就行了。假设已经确定了前 \\(i\\) 个点中不被覆盖的点，那么每次考虑上一个没被覆盖的点，不断往前推且删除绿色线段，则可以生成所有需要删除的线段。

上面的分析中已经分析出了子问题结构，考虑 dp。设 \\(f_{i, j}\\) 表示考虑前 \\(i\\) 个点且最后一个未被覆盖的点为 \\(i\\)，当前删去了 \\(j\\) 条线段，最多有多少个点不被覆盖，\\(del(i, t)\\) 表示满足 \\(t < l \\le i \\le r\\) 的线段数量，也就是图中绿色线段的数量，那么可以得到状态转移方程：

\[f_{i, j} = \min ^ {i - 1} _ {t = 0} {f_{t, j - del(i, t)} + 1}
\]

这个方程直接转移是 \\(O(n ^ 2 k)\\) 的，所以需要优化。

首先如果覆盖在 \\(i\\) 上面的线段超过了 \\(k\\) 条，那么 \\(i\\) 一定会被覆盖。接下来只考虑 \\(i\\) 上面的线段小于 \\(k\\) 条的情况，此时有 \\(del(i, x) \\le k\\)。

容易发现当 \\(t\\) 减小的时候，\\(del(i, t)\\) 会随之增大，且不会超过 \\(k\\)。

假设有 \\(tt\\) 条线段覆盖在 \\(i\\) 上面，将覆盖在 \\(i\\) 上的线段按左端点从小到大排序，得到一个左端点序列 \\(\\left\\{L_1, L_2, \\dots L_{tt}\\right\\}\\)。

这个序列将 \\([1, i - 1]\\) 划分成了很多个区间 \\([0, L_1 - 1], [L_1, L_2 - 1], \\dots, [L_{tt}, i - 1]\\)，对于在同一个区间中的 \\(t\\)，\\(del(i, t)\\)都是相等的。因此可以用数据结构去维护这 \\(tt + 1\\) 个区间的最小值优化转移。

动态 st 表可以做到 \\(O(\\log n)\\) 插入一个数，\\(O(1)\\) 查询区间 RMQ。具体而言，将 st 表倒过来，设 \\(st_{i, p}\\) 表示以 \\(i\\) 结尾的 \\(2^p\\) 个数的最小值，就能够动态的在序列尾端插入，而且常数较小。用 st 表对于每个 \\(p\\) 维护 \\(f_{x, p}\\) 的最小值即可快速转移。

最后问题只剩下如何对于每个 \\(i\\) 快速得到左端点序列 \\(L\\)。

利用差分思想。对每个位置维护两个集合 \\(add, del\\)， 分别表示这个位置相对于上一个位置增加的线段编号和减小的线段编号。先依次考虑每条线段。考虑线段 \\(i\\)，其影响区间是 \\(l_i\\) 到 \\(r_i\\)，那么在 \\(add_{l_i}\\) 集合中插入 \\(i\\)，并在 \\(del_{r_i + 1}\\) 集合中插入 \\(i\\)。

维护完 \\(add\\) 和 \\(del\\) 集合后，从 \\(1\\) 号点到 \\(n\\) 号点扫一遍。维护当前线段集合 \\(cover\\)，初始为空。考虑 \\(i\\) 号点时，将 \\(add_i\\) 内的元素插入到集合 \\(cover\\) 中，然后再将 \\(del_i\\) 内的元素从 \\(cover\\) 中删除，这样此时的 \\(cover\\) 集合就存储了覆盖 \\(i\\) 号点的所有线段。如果集合大小不大于 \\(k\\)，那么集合中线段的左端点就构成了 \\(i\\) 这个点的左端点序列 \\(L\\)。

维护完 \\(L\\) 后按上面的思路 dp 即可。

### Code

```cpp
#include <iostream>
#include <fstream>
#include <algorithm>
#include <vector>
#include <set>
#include <cstring>
using namespace std;
const int inf = 0x3f3f3f3f;
namespace SparseTable {
//	bool bst;
	int st[11][18][200005];
//	bool bed;
	int lg[200005];
	int Init() {
		lg[0] = -1;
		for (int i = 1; i <= 200000; i ++)
			lg[i] = lg[i >> 1] + 1;
		return 0;
	}
	struct Table {
		int tot = 0, z;
		int clear() {
			tot = 0, z = 0;
			return 0;
		}
		int insert(int x) {
			tot ++;
			st[z][0][tot] = x;
			int u = tot;
			for (int i = 1; u - (1 << i) >= 0; i ++)
				st[z][i][u] = (max(st[z][i - 1][u], st[z][i - 1][u - (1 << (i - 1))]));
			return 0;
		}
		int query(int l, int r) {
			l ++, r ++;
			if (l > r) return -inf;
			int len = lg[r - l + 1];
			return max(st[z][len][r], st[z][len][l + (1 << len) - 1]);
		}
	};
}
namespace solve1 {
	struct Node {
		int a;
		Node(int x) {
			a = x;
		}
	};
	bool operator<(Node a, Node b) {
		return a.a > b.a;
	}
	int n, m, k;
	using namespace SparseTable;
	Table st[11];
	pair<int, int> a[200005];
	#define l(u) a[u].first
	#define r(u) a[u].second
	set<int> add[200005], del[200005];
	set<Node> cover;
	vector<int> cov[200005];
	bool vis[200005];
	int f[200005][11];
	int clear() {
		for (int i = 0; i <= 10; i ++)
			st[i].clear(), st[i].z = i;
		for (int i = 1; i <= n + 1; i ++)
			cov[i].clear(), vis[i] = 0;
		return 0;
	}
	int main() {
		clear();
		cin >> n >> m >> k;
		for (int i = 1; i <= m; i ++)
			cin >> l(i) >> r(i);
		sort(a + 1, a + m + 1);
		for (int i = 1; i <= m; i ++)
			add[l(i)].insert(i), del[r(i) + 1].insert(i);
		for (int i = 1; i <= n + 1; i ++) {
			cov[i].push_back(i);
			for (int j : del[i]) cover.erase(Node(j));
			for (int j : add[i]) cover.insert(Node(j));
			add[i].clear(), del[i].clear();
			if (int(cover.size()) > k) vis[i] = 1;
			int cnt = 0;
			if (!vis[i] && (cover.size()))
				for (Node j : cover) {
					if (cnt == k) break;
					cov[i].push_back(l(j.a)), cnt ++;
				}
		}
		for (int i = 0; i <= k; i ++)
			st[i].insert(0);
		int ret = 0;
		for (int i = 1; i <= n; i ++) {
			if (vis[i]) {
				for (int j = 0; j <= k; j ++)
					st[j].insert(-inf), f[i][j] = -inf;
				continue;
			}
			int tt = cov[i].size();
			for (int j = 0; j < tt - 1; j ++)
				f[i][j] = -inf;
			for (int j = tt - 1; j <= k; j ++) {
				f[i][j] = 0;
				for (int p = 0; p < tt; p ++) {
					if (p > j) break;
					if (p != tt - 1)
						f[i][j] = max(f[i][j], st[j - p].query(cov[i][p + 1], cov[i][p] - 1) + 1);
					else
						f[i][j] = max(f[i][j], st[j - p].query(0, cov[i][p] - 1) + 1);
				}
			}
			for (int j = 0; j <= k; j ++)
				st[j].insert(f[i][j]), ret = max(ret, f[i][j])/*, cout << i << " " << j << " " << f[i][j] << "\n"*/;
		}
		cout << ret << "\n";
		return 0;
	}
}
signed main() {
	ios::sync_with_stdio(0);
	cin.tie(0), cout.tie(0);
	int T = 1;
	cin >> T;
	SparseTable::Init();
	while (T --)
		solve1::main();
	return 0;
}
```
